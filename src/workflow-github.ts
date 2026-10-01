import { createHash } from 'node:crypto'
import { decide } from './decide'
import { runner } from './github'
import { loadPolicy } from './policy'
import { appendDecision } from './store'
import type { WorkItemRef } from './types'
import { object } from './workflow-store'
import type { IntakeComment } from './workflow-types'

export function allowWorkflowOperation(root: string, argv: string[]): void {
  const command = ['gh', ...argv]
    .map((arg) => (/^[A-Za-z0-9_./:{}?=%+-]+$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(' ')
  const verdict = decide(
    {
      sessionId: process.env.CLAUDE_CODE_SESSION_ID ?? 'cli',
      cwd: root,
      worktreePath: root,
      toolName: 'Bash',
      toolInput: { command }
    },
    loadPolicy(root)
  )
  appendDecision(root, {
    ts: new Date().toISOString(),
    session: process.env.CLAUDE_CODE_SESSION_ID ?? 'cli',
    tool: 'Bash',
    summary: command.slice(0, 200),
    decision: verdict.decision,
    rule: verdict.rule,
    reverse: verdict.trip === null ? 'n/a' : `blocked on ${verdict.trip}`
  })
  if (verdict.decision !== 'allow')
    throw new Error(
      `Workflow operation needs normal policy approval: ${verdict.decision} (${verdict.rule}). No operation was attempted.`
    )
}

export function workflowRepository(root: string, item: WorkItemRef): string {
  const repoRun = runner.run(root, ['repo', 'view', '--json', 'id,nameWithOwner'])
  let repo: unknown
  let bound: unknown
  try {
    repo = repoRun.ok ? JSON.parse(repoRun.stdout) : null
  } catch {
    repo = null
  }
  if (
    !object(repo) ||
    repo.id !== item.repoNodeId ||
    typeof repo.nameWithOwner !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.nameWithOwner)
  )
    throw new Error(
      'Selected GitHub repository does not match the bound repository; no workflow operation was attempted.'
    )
  const name = repo.nameWithOwner
  const itemRun = runner.run(root, ['api', `repos/${name}/issues/${item.number}`])
  try {
    bound = itemRun.ok ? JSON.parse(itemRun.stdout) : null
  } catch {
    bound = null
  }
  if (
    !object(bound) ||
    bound.node_id !== item.itemNodeId ||
    (object(bound.pull_request) ? 'pr' : 'issue') !== item.kind
  )
    throw new Error('GitHub item does not match the bound work item; no workflow operation was attempted.')
  return name
}

export function fetchWorkflowComments(root: string, item: WorkItemRef): IntakeComment[] {
  const repo = workflowRepository(root, item)
  const run = runner.run(root, [
    'api',
    `repos/${repo}/issues/${item.number}/comments?per_page=100`,
    '--paginate',
    '--slurp'
  ])
  if (!run.ok) throw new Error('Workflow comment fetch failed; the previous intake was preserved.')
  let pages: unknown
  try {
    pages = JSON.parse(run.stdout)
  } catch {
    throw new Error('Malformed workflow comment response; intake was preserved.')
  }
  if (!Array.isArray(pages) || !pages.every(Array.isArray))
    throw new Error('Malformed paginated workflow comments; intake was preserved.')
  const out: IntakeComment[] = []
  for (const page of pages)
    for (const value of page) {
      if (
        !object(value) ||
        !Number.isSafeInteger(value.id) ||
        Number(value.id) <= 0 ||
        !object(value.user) ||
        typeof value.user.login !== 'string' ||
        typeof value.body !== 'string' ||
        typeof value.updated_at !== 'string' ||
        typeof value.html_url !== 'string' ||
        !value.html_url.startsWith('https://github.com/')
      )
        throw new Error('Malformed workflow comment; intake was preserved.')
      const body = value.body
      const updatedAt = value.updated_at
      out.push({
        id: String(value.id),
        author: value.user.login,
        url: value.html_url,
        body,
        updatedAt,
        deleted: false,
        fingerprint: createHash('sha256').update(`${body}\0${updatedAt}`).digest('hex')
      })
    }
  if (new Set(out.map((comment) => comment.id)).size !== out.length)
    throw new Error('Duplicate comment IDs in workflow response; intake was preserved.')
  return out
}

export function workflowViewer(root: string): string {
  const run = runner.run(root, ['api', 'user', '--jq', '.login'])
  const login = run.stdout.trim()
  if (!run.ok || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login))
    throw new Error('Could not verify the authenticated verdict author; no publication was attempted.')
  return login
}

export function writeWorkflowComment(root: string, item: WorkItemRef, body: string, commentId: string | null): string {
  const repo = workflowRepository(root, item)
  const path =
    commentId === null ? `repos/${repo}/issues/${item.number}/comments` : `repos/${repo}/issues/comments/${commentId}`
  const argv = ['api', path, '-X', commentId === null ? 'POST' : 'PATCH', '--input', '-']
  allowWorkflowOperation(root, argv)
  const run = runner.run(root, argv, JSON.stringify({ body }))
  if (!run.ok) throw new Error('Workflow verdict publication failed; retry is available.')
  let response: unknown
  try {
    response = JSON.parse(run.stdout)
  } catch {
    throw new Error('Malformed workflow publication response.')
  }
  if (!object(response) || (!Number.isSafeInteger(response.id) && typeof response.id !== 'string'))
    throw new Error('Malformed workflow publication identifier.')
  return String(response.id)
}
