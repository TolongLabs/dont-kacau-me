import { spawnSync } from 'node:child_process'
import type { CheckResult, WorkItemRef } from './types'

export type AmbientEvent = {
  kind: 'issue' | 'pr'
  nodeId: string
  number: number
  headline: string
  url: string
  updatedAt: string
}

type RunResult = {
  ok: boolean
  stdout: string
  stderr: string
}

export type Runner = (repoRoot: string, argv: string[], input?: string) => RunResult

const MARKER = '<!-- dkm:receipt v1 -->'

function defaultRunner(repoRoot: string, argv: string[], input?: string): RunResult {
  const result = spawnSync('gh', argv, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 10000,
    input,
    maxBuffer: 10 * 1024 * 1024
  })
  return {
    ok: result.status === 0 && result.error === undefined,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

export const runner: { run: Runner } = { run: defaultRunner }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

function toConclusion(status: unknown, conclusion: unknown): CheckResult['conclusion'] {
  if (status !== 'completed') return 'pending'
  if (conclusion === 'success') return 'success'
  if (conclusion === 'failure') return 'failure'
  if (conclusion === 'neutral') return 'neutral'
  if (conclusion === 'cancelled') return 'cancelled'
  if (conclusion === 'timed_out') return 'timed_out'
  if (conclusion === 'skipped') return 'skipped'
  return 'pending'
}

export function fetchChecks(repoRoot: string, ref: string): CheckResult[] {
  const run = runner.run(repoRoot, ['api', `repos/{owner}/{repo}/commits/${ref}/check-runs`])
  if (!run.ok) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return []
  }
  if (!isObject(parsed)) return []
  const runs = parsed.check_runs
  if (!Array.isArray(runs)) return []
  const out: CheckResult[] = []
  for (const check of runs) {
    if (!isObject(check)) continue
    const id = check.id
    const name = check.name
    const status = check.status
    const conclusion = check.conclusion
    const attempt = check.run_attempt
    if (!isNumber(id) || !isString(name) || !isString(status)) continue
    out.push({
      checkRunId: String(id),
      name,
      attempt: isNumber(attempt) ? attempt : 1,
      conclusion: toConclusion(status, conclusion)
    })
  }
  return out
}

export function findReceiptComment(repoRoot: string, item: WorkItemRef): { id: string; body: string } | null {
  const run = runner.run(repoRoot, ['api', `repos/{owner}/{repo}/issues/${item.number}/comments`])
  if (!run.ok) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  for (const comment of parsed) {
    if (!isObject(comment)) continue
    const id = comment.id
    const body = comment.body
    if (!isString(body) || (!isNumber(id) && !isString(id))) continue
    if (body.startsWith(MARKER)) {
      return { id: String(id), body }
    }
  }
  return null
}

export function upsertReceiptComment(repoRoot: string, item: WorkItemRef, body: string): string {
  const existing = findReceiptComment(repoRoot, item)
  if (existing) {
    const run = runner.run(
      repoRoot,
      ['api', `repos/{owner}/{repo}/issues/comments/${existing.id}`, '--method', 'PATCH', '--input', '-'],
      JSON.stringify({ body })
    )
    if (!run.ok) throw new Error(run.stderr || 'gh failed')
    let response: unknown
    try {
      response = JSON.parse(run.stdout)
    } catch {
      throw new Error(run.stderr || 'gh failed')
    }
    if (!isObject(response)) throw new Error(run.stderr || 'gh failed')
    const id = response.id
    if (!isNumber(id) && !isString(id)) throw new Error(run.stderr || 'gh failed')
    return String(id)
  }
  const run = runner.run(
    repoRoot,
    ['api', `repos/{owner}/{repo}/issues/${item.number}/comments`, '--method', 'POST', '--input', '-'],
    JSON.stringify({ body })
  )
  if (!run.ok) throw new Error(run.stderr || 'gh failed')
  let response: unknown
  try {
    response = JSON.parse(run.stdout)
  } catch {
    throw new Error(run.stderr || 'gh failed')
  }
  if (!isObject(response)) throw new Error(run.stderr || 'gh failed')
  const id = response.id
  if (!isNumber(id) && !isString(id)) throw new Error(run.stderr || 'gh failed')
  return String(id)
}

/**
 * The repository is the checkout's own, resolved by `gh` from its remote. It is deliberately not a
 * parameter: this used to take the repo node ID and interpolate it into the path, which is not a
 * REST identifier, so every fetch 404ed and fail-softed to nothing.
 */
export function fetchSince(repoRoot: string, sinceIso: string): AmbientEvent[] {
  const run = runner.run(repoRoot, [
    'api',
    `repos/{owner}/{repo}/issues?since=${encodeURIComponent(sinceIso)}&state=all&sort=updated&per_page=30`
  ])
  if (!run.ok) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: AmbientEvent[] = []
  for (const item of parsed) {
    if (!isObject(item)) continue
    const nodeId = item.node_id
    const number = item.number
    const headline = item.title
    const url = item.html_url
    const updatedAt = item.updated_at
    if (!isString(nodeId) || !isNumber(number) || !isString(headline) || !isString(url) || !isString(updatedAt)) {
      continue
    }
    const pullRequest = item.pull_request
    const kind: AmbientEvent['kind'] = isObject(pullRequest) ? 'pr' : 'issue'
    out.push({ kind, nodeId, number, headline, url, updatedAt })
  }
  return out
}

export function workItemByNumber(repoRoot: string, number: number): WorkItemRef | null {
  const run = runner.run(repoRoot, [
    'api',
    `repos/{owner}/{repo}/issues/${number}`,
    '--jq',
    '{id: .node_id, number: .number, isPr: (.pull_request != null), repo: .repository_url}'
  ])
  if (!run.ok) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return null
  }
  if (!isObject(parsed)) return null
  const id = parsed.id
  const num = parsed.number
  if (!isString(id) || !isNumber(num)) return null
  const repo = repoNodeId(repoRoot)
  if (repo === null) return null
  return { repoNodeId: repo, itemNodeId: id, number: num, kind: parsed.isPr === true ? 'pr' : 'issue' }
}

/**
 * The ambient tier polls a repository nobody has bound an item in, so there is no WorkItemRef to
 * take a repoNodeId from. Resolved here rather than assumed, because the id keys the ingest cursor
 * and a wrong one silently re-delivers or drops every ambient event for that repository.
 */
export function repoNodeId(repoRoot: string): string | null {
  const run = runner.run(repoRoot, ['repo', 'view', '--json', 'id', '--jq', '.id'])
  if (!run.ok) return null
  const id = run.stdout.trim()
  return id.length > 0 ? id : null
}
