import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHead } from './git'
import { runner } from './github'
import type { CheckResult, WorkItemRef } from './types'
import { requestId, requireWorkflow, staleRequest, syncWorkflow } from './workflow'
import { allowWorkflowOperation } from './workflow-github'
import { loadWorkflowConfig, object, readWorkflow, updateWorkflow } from './workflow-store'
import type { PullObservation, ReleasePlan, WorkflowRequest, WorkflowState } from './workflow-types'

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function checksAt(root: string, head: string): { available: boolean; checks: CheckResult[] } {
  const run = runner.run(root, [
    'api',
    `repos/{owner}/{repo}/commits/${head}/check-runs?per_page=100`,
    '--paginate',
    '--slurp'
  ])
  const pages = run.ok ? parse(run.stdout) : null
  if (!Array.isArray(pages) || !pages.every((page) => object(page) && Array.isArray(page.check_runs)))
    return { available: false, checks: [] }
  const checks: CheckResult[] = []
  for (const page of pages)
    for (const value of page.check_runs) {
      if (
        !object(value) ||
        !Number.isSafeInteger(value.id) ||
        typeof value.name !== 'string' ||
        typeof value.status !== 'string'
      )
        return { available: false, checks: [] }
      const conclusion =
        value.status === 'completed' &&
        ['success', 'failure', 'neutral', 'cancelled', 'timed_out', 'skipped'].includes(String(value.conclusion))
          ? (value.conclusion as CheckResult['conclusion'])
          : 'pending'
      checks.push({
        name: value.name,
        checkRunId: String(value.id),
        attempt: typeof value.run_attempt === 'number' ? value.run_attempt : 1,
        conclusion
      })
    }
  return { available: true, checks }
}

function pullAt(root: string, request: WorkflowRequest): PullObservation | null {
  if (request.prNumber === null) return null
  const run = runner.run(root, ['pr', 'view', String(request.prNumber), '--json', 'state,headRefOid,mergeCommit,url'])
  const value = run.ok ? parse(run.stdout) : null
  if (
    !object(value) ||
    !['OPEN', 'CLOSED', 'MERGED'].includes(String(value.state)) ||
    typeof value.headRefOid !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.headRefOid)
  )
    return null
  const mergedHead =
    object(value.mergeCommit) &&
    typeof value.mergeCommit.oid === 'string' &&
    /^[a-f0-9]{40}$/.test(value.mergeCommit.oid)
      ? value.mergeCommit.oid
      : null
  const checks = checksAt(root, value.headRefOid)
  return {
    head: value.headRefOid,
    mergedHead,
    state: value.state as PullObservation['state'],
    checksAvailable: checks.available,
    checks: checks.checks,
    observedAt: new Date().toISOString()
  }
}

export function observeWorkflow(root: string, item: WorkItemRef): WorkflowState {
  requireWorkflow(root)
  const state = readWorkflow(root, item)
  const observed = new Map(state.requests.map((request) => [requestId(request), pullAt(root, request)]))
  return updateWorkflow(root, item, state.revision, (next) => {
    for (const request of next.requests) request.observation = observed.get(requestId(request)) ?? null
  })
}

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 })
  if (result.status !== 0 || result.error) throw new Error('Git could not verify the release checkout.')
  return result.stdout.trim()
}

function noteText(text: string): string {
  return text
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\r\n]+/g, ' ')
}

export function planRelease(root: string, item: WorkItemRef, version: string): ReleasePlan {
  requireWorkflow(root)
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('Use a stable semantic version such as 1.1.0; version intent is not inferred from comments.')
  const config = loadWorkflowConfig(root)
  const state = readWorkflow(root, item)
  const head = resolveHead(root)
  const blockers: string[] = []
  if (!config.release.enabled) blockers.push('Release publication is disabled.')
  if (git(root, ['symbolic-ref', '--short', 'HEAD']) !== config.release.targetBranch)
    blockers.push('Release target branch does not match the current checkout.')
  if (git(root, ['status', '--porcelain', '--untracked-files=all'])) blockers.push('Release needs a clean checkout.')
  if (config.release.requiredChecks.length === 0)
    blockers.push('Required hosted checks must be configured; no checks is not verification.')
  if (config.release.requiredChecks.length > 0) {
    const target = checksAt(root, head)
    if (!target.available) blockers.push('Release head hosted checks are unavailable.')
    for (const name of config.release.requiredChecks) {
      const matches = target.checks.filter((check) => check.name === name)
      if (matches.length === 0 || matches.some((check) => check.conclusion !== 'success'))
        blockers.push(`Release head required checks ${name} have not succeeded.`)
    }
  }
  const accepted = state.requests.filter((request) => request.decision === 'accepted')
  if (accepted.length === 0) blockers.push('No accepted delivered requests are recorded.')
  for (const source of state.comments)
    if (!source.deleted && !state.requests.some((request) => request.commentId === source.id))
      blockers.push(`Comment ${source.id} is untriaged.`)
  for (const request of state.requests) {
    if (staleRequest(state, request)) blockers.push(`Request ${requestId(request)} needs current-source re-review.`)
    if (request.decision === 'needs-owner') blockers.push(`Request ${requestId(request)} needs owner judgment.`)
  }
  for (const request of accepted) {
    if (!['merged', 'released'].includes(request.delivery))
      blockers.push(`Request ${requestId(request)} is ${request.delivery}, not merged.`)
    const seen = request.observation
    if (seen?.state !== 'MERGED' || seen.head !== request.implementationHead || !seen.mergedHead) {
      blockers.push(`Request ${requestId(request)} has no matching observed merged PR.`)
      continue
    }
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', seen.mergedHead, head], {
      cwd: root,
      timeout: 5000
    })
    if (ancestor.status !== 0) blockers.push(`Request ${requestId(request)} is not in the release head.`)
    if (!seen.checksAvailable) blockers.push(`Hosted checks for ${requestId(request)} are unavailable.`)
    for (const name of config.release.requiredChecks) {
      const matches = seen.checks.filter((check) => check.name === name)
      if (matches.length === 0 || matches.some((check) => check.conclusion !== 'success'))
        blockers.push(`Required checks ${name} for ${requestId(request)} have not succeeded.`)
    }
  }
  const tag = `${config.release.tagPrefix}${version}`
  const notes = [
    `# ${tag}`,
    '',
    'Delivered requests (agent summaries; linked implementation and checks observed separately):',
    '',
    ...accepted.map(
      (request) =>
        `- ${noteText(request.summary)} — ${request.link || `PR #${request.prNumber ?? 'unknown'}`} (${request.implementationHead.slice(0, 7)})`
    ),
    '',
    `Exact release head: ${head}`,
    '',
    ...blockers.map((blocker) => `Blocked: ${blocker}`)
  ].join('\n')
  return { version, tag, head, notes, blockers }
}

function existingRelease(root: string, tag: string): { url: string } | null {
  const run = runner.run(root, ['release', 'view', tag, '--json', 'tagName,targetCommitish,url'])
  if (!run.ok) {
    if (run.stderr.includes('HTTP 404')) return null
    throw new Error('Could not verify whether the release already exists; no publication was attempted.')
  }
  const value = parse(run.stdout)
  if (
    !object(value) ||
    value.tagName !== tag ||
    typeof value.url !== 'string' ||
    !value.url.startsWith('https://github.com/')
  )
    throw new Error('Malformed existing release observation.')
  return { url: value.url }
}

function existingTag(root: string, tag: string): string | null {
  let run = runner.run(root, ['api', `repos/{owner}/{repo}/git/ref/tags/${tag}`])
  if (!run.ok) {
    if (run.stderr.includes('HTTP 404')) return null
    throw new Error('Could not verify the existing tag; no publication was attempted.')
  }
  let value = parse(run.stdout)
  for (let depth = 0; depth < 4; depth++) {
    if (
      !object(value) ||
      !object(value.object) ||
      typeof value.object.sha !== 'string' ||
      !/^[a-f0-9]{40}$/.test(value.object.sha)
    )
      throw new Error('Malformed release tag observation.')
    if (value.object.type === 'commit') return value.object.sha
    if (value.object.type !== 'tag') throw new Error('Release tag does not resolve to a commit.')
    run = runner.run(root, ['api', `repos/{owner}/{repo}/git/tags/${value.object.sha}`])
    if (!run.ok) throw new Error('Could not resolve annotated release tag.')
    value = parse(run.stdout)
  }
  throw new Error('Release tag chain is too deep to verify safely.')
}

export function publishRelease(
  root: string,
  item: WorkItemRef,
  version: string,
  expectedHead: string,
  approved: boolean
): { tag: string; head: string; url: string } {
  if (!approved) throw new Error('Release publication needs explicit approval; intake decisions are never approval.')
  if (!/^[a-f0-9]{40}$/.test(expectedHead) || resolveHead(root) !== expectedHead)
    throw new Error('Release head changed or was not pinned; prepare a new plan.')
  syncWorkflow(root, item)
  observeWorkflow(root, item)
  const plan = planRelease(root, item, version)
  if (plan.blockers.length > 0) throw new Error(plan.blockers.join(' '))
  if (plan.head !== expectedHead) throw new Error('Release head changed; no publication was attempted.')
  const found = existingRelease(root, plan.tag)
  const tagHead = existingTag(root, plan.tag)
  if (tagHead !== null && tagHead !== expectedHead)
    throw new Error('The existing tag points at another commit; it will not be overwritten.')
  let url = found?.url
  if (!found) {
    const directory = join(root, '.dkm', 'release-notes')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `${randomUUID()}.md`)
    const argv = ['release', 'create', plan.tag, '--target', expectedHead, '--title', plan.tag, '--notes-file', path]
    try {
      writeFileSync(path, plan.notes, { mode: 0o600 })
      allowWorkflowOperation(root, argv)
      if (resolveHead(root) !== expectedHead || git(root, ['status', '--porcelain', '--untracked-files=all']))
        throw new Error('Release checkout changed before publication.')
      const made = runner.run(root, argv)
      if (!made.ok)
        throw new Error('Release publication did not confirm completion; inspect/retry, never assume success.')
      const confirmed = existingRelease(root, plan.tag)
      if (!confirmed || existingTag(root, plan.tag) !== expectedHead)
        throw new Error('Release result could not be verified; inspect/retry before claiming success.')
      url = confirmed.url
    } finally {
      rmSync(path, { force: true })
    }
  } else if (tagHead !== expectedHead) throw new Error('Existing release has no matching observed tag.')
  if (!url) throw new Error('Release URL was not observed.')
  const release = { tag: plan.tag, head: expectedHead, url }
  const state = readWorkflow(root, item)
  if (
    !state.releases.some(
      (value) => value.tag === release.tag && value.head === release.head && value.url === release.url
    )
  )
    updateWorkflow(root, item, state.revision, (next) => {
      next.releases.push(release)
    })
  return release
}
