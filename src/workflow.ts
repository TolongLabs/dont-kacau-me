import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseReceipt } from './receipt'
import type { WorkItemRef } from './types'
import { fetchWorkflowComments, workflowViewer, writeWorkflowComment } from './workflow-github'
import { loadWorkflowConfig, object, readWorkflow, updateWorkflow, workflowPath } from './workflow-store'
import {
  decisions,
  deliveries,
  type RequestHistory,
  type RequestInput,
  type WorkflowRequest,
  type WorkflowState
} from './workflow-types'

export const WORKFLOW_MARKER = '<!-- dkm:workflow v1 -->'

export function requireWorkflow(root: string): void {
  if (!loadWorkflowConfig(root).enabled)
    throw new Error(
      'Workflow is disabled. Enable the committed workflow contract explicitly; permission policy is separate.'
    )
}

export function requestId(request: Pick<RequestInput, 'commentId' | 'key'>): string {
  return `${request.commentId}:${request.key}`
}

export function staleRequest(state: WorkflowState, request: WorkflowRequest): boolean {
  if (request.decision === 'superseded') return false
  const source = state.comments.find((comment) => comment.id === request.commentId)
  return !source || source.deleted || source.fingerprint !== request.reviewedFrom
}

export function syncWorkflow(root: string, item: WorkItemRef): WorkflowState {
  requireWorkflow(root)
  const state = readWorkflow(root, item)
  const all = fetchWorkflowComments(root, item)
  let publication = state.publication
  if (publication !== null) {
    const remote = all.find((comment) => comment.id === publication?.commentId)
    publication = remote
      ? { commentId: remote.id, fingerprint: createHash('sha256').update(remote.body).digest('hex') }
      : null
    if (publication?.fingerprint === state.publication?.fingerprint) publication = state.publication
  }
  if (publication === null && all.some((comment) => comment.body.startsWith(WORKFLOW_MARKER))) {
    const viewer = workflowViewer(root)
    const own = all.filter((comment) => comment.author === viewer && comment.body.startsWith(WORKFLOW_MARKER))
    if (own.length > 1) throw new Error('Multiple own verdict comments found; inspect them before publication.')
    if (own[0])
      publication = {
        commentId: own[0].id,
        fingerprint: createHash('sha256').update(own[0].body).digest('hex')
      }
  }
  const fetched = all.filter((comment) => comment.id !== publication?.commentId && parseReceipt(comment.body) === null)
  const ids = new Set(fetched.map((comment) => comment.id))
  const comments = [
    ...fetched,
    ...state.comments
      .filter((comment) => comment.id !== publication?.commentId && !ids.has(comment.id))
      .map((comment) => ({ ...comment, deleted: true }))
  ]
  comments.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
  if (JSON.stringify(comments) === JSON.stringify(state.comments) && publication === state.publication) return state
  return updateWorkflow(root, item, state.revision, (next) => {
    next.comments = comments
    next.publication = publication
  })
}

function validateRequest(value: unknown): RequestInput {
  const fields = [
    'commentId',
    'key',
    'reviewedFrom',
    'summary',
    'decision',
    'why',
    'phase',
    'link',
    'delivery',
    'reportedVerification',
    'implementationHead',
    'prNumber',
    'supersedes'
  ]
  if (!object(value) || Object.keys(value).some((key) => !fields.includes(key)))
    throw new Error('Invalid workflow request fields.')
  for (const field of [
    'commentId',
    'key',
    'reviewedFrom',
    'summary',
    'why',
    'phase',
    'link',
    'reportedVerification',
    'implementationHead'
  ])
    if (typeof value[field] !== 'string') throw new Error(`Workflow request needs ${field}.`)
  if (!decisions.includes(value.decision as never) || !deliveries.includes(value.delivery as never))
    throw new Error('Invalid workflow decision or delivery state; neither is permission.')
  if (!/^\d+$/.test(String(value.commentId)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(String(value.key)))
    throw new Error('Invalid workflow request identity.')
  if (!/^[a-f0-9]{64}$/.test(String(value.reviewedFrom)))
    throw new Error('Use the current comment fingerprint to review a request.')
  if (
    !String(value.summary).trim() ||
    String(value.summary).length > 240 ||
    !String(value.why).trim() ||
    String(value.why).length > 1500 ||
    String(value.reportedVerification).length > 1500 ||
    String(value.phase).length > 120
  )
    throw new Error('Request summary/rationale is missing or too long.')
  if (
    value.link &&
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(issues|pull)\/\d+$/.test(String(value.link))
  )
    throw new Error('Use a GitHub issue/PR link, not arbitrary output.')
  if (value.implementationHead && !/^[a-f0-9]{40}$/.test(String(value.implementationHead)))
    throw new Error('Use a full implementation SHA.')
  if (value.prNumber !== null && (!Number.isSafeInteger(value.prNumber) || Number(value.prNumber) <= 0))
    throw new Error('Invalid implementation PR number.')
  if (
    value.supersedes !== null &&
    (typeof value.supersedes !== 'string' || !/^\d+:[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.supersedes))
  )
    throw new Error('Invalid supersession identity.')
  return value as RequestInput
}

function snapshot({ history: _history, ...request }: WorkflowRequest): RequestHistory {
  return request
}

export function recordRequest(root: string, item: WorkItemRef, raw: unknown): WorkflowState {
  requireWorkflow(root)
  const input = validateRequest(raw)
  const state = readWorkflow(root, item)
  const source = state.comments.find((comment) => comment.id === input.commentId)
  if (!source || source.deleted) throw new Error('Source comment is missing or removed; sync before reviewing it.')
  if (source.fingerprint !== input.reviewedFrom)
    throw new Error('Source comment changed; review its current version before recording a decision.')
  return updateWorkflow(root, item, state.revision, (next) => {
    const previous = next.requests.find((request) => requestId(request) === requestId(input))
    const history = previous ? [...previous.history, snapshot(previous)] : []
    const observation =
      previous && previous.implementationHead === input.implementationHead && previous.prNumber === input.prNumber
        ? previous.observation
        : null
    if (input.supersedes !== null) {
      const old = next.requests.find((request) => requestId(request) === input.supersedes)
      if (!old || requestId(old) === requestId(input))
        throw new Error('Superseded request does not exist or points to itself.')
      old.history.push(snapshot(old))
      old.decision = 'superseded'
    }
    next.requests = next.requests.filter((request) => requestId(request) !== requestId(input))
    next.requests.push({ ...input, history, observation })
  })
}

function cell(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('`', '\\`')
    .replace(/[\r\n]+/g, ' ')
}

function verification(request: WorkflowRequest): string {
  const seen = request.observation
  if (!seen) return request.reportedVerification ? `Reported: ${cell(request.reportedVerification)}` : 'Not observed'
  const merged =
    seen.state === 'MERGED' && seen.head === request.implementationHead
      ? `PR merge observed at ${seen.mergedHead?.slice(0, 7) ?? 'unknown'}. `
      : 'Merge not confirmed. '
  const checks = !seen.checksAvailable
    ? 'Hosted checks unavailable.'
    : seen.checks.length === 0
      ? 'No hosted checks observed.'
      : `Hosted checks: ${seen.checks.filter((check) => check.conclusion === 'success').length}/${seen.checks.length} success.`
  return merged + checks + (request.reportedVerification ? ` Reported: ${cell(request.reportedVerification)}` : '')
}

export function renderWorkflow(state: WorkflowState): string {
  const lines = [
    WORKFLOW_MARKER,
    '',
    `# Intake Verdicts for #${state.workItem.number}`,
    '',
    'Agent judgments and delivery claims are reported, never permission. Only labelled GitHub observations are measured.',
    '',
    '| Request | Decision | Why | Phase | Delivery | Issue/PR | Verification |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  ]
  for (const request of state.requests) {
    const source = state.comments.find((comment) => comment.id === request.commentId)
    const stale = staleRequest(state, request)
    const status = [request.decision, source?.deleted ? 'Source removed' : stale ? 'Needs re-review' : '']
      .filter(Boolean)
      .join(' · ')
    lines.push(
      `| ${cell(request.summary)} (${cell(requestId(request))}) | ${status} | ${cell(request.why)} | ${cell(request.phase)} | ${request.delivery} (reported) | ${request.link || '—'} | ${verification(request)} |`
    )
  }
  for (const comment of state.comments.filter(
    (source) => !source.deleted && !state.requests.some((request) => request.commentId === source.id)
  )) {
    lines.push(
      `| Untriaged comment ${cell(comment.id)} | Needs review | No request decisions recorded | — | Planned | ${comment.url} | Not observed |`
    )
  }
  lines.push('', '<!-- /dkm:workflow -->')
  return lines.join('\n')
}

export function publishWorkflow(root: string, item: WorkItemRef): WorkflowState {
  requireWorkflow(root)
  const lock = `${workflowPath(root, item)}.publish.lock`
  mkdirSync(dirname(lock), { recursive: true })
  let fd: number
  try {
    fd = openSync(lock, 'wx', 0o600)
  } catch {
    throw new Error('Workflow publisher is busy; inspect a stale publication lock before removing it.')
  }
  try {
    const state = syncWorkflow(root, item)
    const body = renderWorkflow(state)
    const fingerprint = createHash('sha256').update(body).digest('hex')
    if (state.publication?.fingerprint === fingerprint) return state
    const id = writeWorkflowComment(root, item, body, state.publication?.commentId ?? null)
    const current = readWorkflow(root, item)
    return updateWorkflow(root, item, current.revision, (next) => {
      next.publication = { commentId: id, fingerprint }
    })
  } finally {
    closeSync(fd)
    rmSync(lock, { force: true })
  }
}
