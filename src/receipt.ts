import { createHash } from 'node:crypto'
import type { ChangedPath, CheckResult, DecisionSummary, Receipt, WorkItemRef } from './types'

const OPEN_MARKER = '<!-- dkm:receipt v1 -->'
const CLOSE_MARKER = '<!-- /dkm:receipt -->'

export function renderReceipt(r: Receipt): string {
  const lines: string[] = []
  lines.push(OPEN_MARKER)
  lines.push('')
  lines.push(`# Receipt for #${r.workItem.number}`)
  lines.push('')
  lines.push('| base | head | observed_at |')
  lines.push('| --- | --- | --- |')
  lines.push(`| \`${r.base}\` | \`${r.head}\` | \`${r.observedAt}\` |`)
  lines.push('')

  if (r.changedPaths.length === 0) {
    lines.push('- _No changed paths_')
  } else {
    for (const cp of r.changedPaths) {
      lines.push(`- ${cp.status} \`${cp.path}\``)
    }
  }
  lines.push('')

  lines.push('| name | run id | attempt | conclusion |')
  lines.push('| --- | --- | --- | --- |')
  if (r.checks.length === 0) {
    lines.push('| _No checks_ | — | — | — |')
  } else {
    for (const c of r.checks) {
      lines.push(`| \`${c.name}\` | \`${c.checkRunId}\` | ${c.attempt} | ${c.conclusion} |`)
    }
  }
  lines.push('')

  if (r.contractDelta.length === 0) {
    lines.push('- _No contract changes_')
  } else {
    for (const d of r.contractDelta) {
      lines.push(`- \`${d}\``)
    }
  }
  lines.push('')

  lines.push(`Decisions: **${r.decisions.allowed} allowed, ${r.decisions.denied} denied, ${r.decisions.asked} asked**`)
  lines.push('')

  lines.push('**Unverified agent narrative**')
  lines.push('')
  for (const line of r.narrative.split('\n')) {
    lines.push(`> ${line}`)
  }
  lines.push('')

  const json = JSON.stringify(r, null, 2)
  const fence = makeFence(json)
  lines.push(`${fence}json`)
  lines.push(json)
  lines.push(fence)

  lines.push(CLOSE_MARKER)
  return lines.join('\n')
}

export function parseReceipt(body: string): Receipt | null {
  const trimmed = body.trimEnd()
  if (!trimmed.startsWith(OPEN_MARKER)) return null
  if (!trimmed.endsWith(CLOSE_MARKER)) return null
  const inner = trimmed.slice(OPEN_MARKER.length, trimmed.length - CLOSE_MARKER.length)
  const json = extractJson(inner)
  if (json === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch {
    return null
  }
  return isReceipt(parsed) ? parsed : null
}

export function receiptFingerprint(r: Receipt): string {
  const sortedBlockers = [...r.blockers].sort()
  const sortedChecks = [...r.checks]
    .sort((a, b) => {
      if (a.checkRunId !== b.checkRunId) return a.checkRunId < b.checkRunId ? -1 : 1
      if (a.attempt !== b.attempt) return a.attempt - b.attempt
      return a.conclusion < b.conclusion ? -1 : a.conclusion > b.conclusion ? 1 : 0
    })
    .map((c) => `${c.checkRunId}:${c.attempt}:${c.conclusion}`)
  const payload = JSON.stringify([r.head, sortedBlockers, sortedChecks])
  return createHash('sha256').update(payload).digest('hex')
}

function makeFence(json: string): string {
  let max = 0
  let current = 0
  for (const ch of json) {
    if (ch === '`') {
      current++
      if (current > max) max = current
    } else {
      current = 0
    }
  }
  return '`'.repeat(Math.max(3, max + 1))
}

function extractJson(inner: string): string | null {
  const lines = inner.split(/\r?\n/)
  let start = -1
  let fenceLength = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(/^(`{3,})json\s*$/)
    if (m?.[1] !== undefined) {
      fenceLength = m[1].length
      start = i + 1
      break
    }
  }
  if (start === -1) return null
  const closing = '`'.repeat(fenceLength)
  for (let i = start; i < lines.length; i++) {
    if (lines[i] === closing) {
      return lines.slice(start, i).join('\n')
    }
  }
  return null
}

function isReceipt(v: unknown): v is Receipt {
  return (
    typeof v === 'object' &&
    v !== null &&
    'eventId' in v &&
    typeof v.eventId === 'string' &&
    'workItem' in v &&
    isWorkItemRef(v.workItem) &&
    'base' in v &&
    typeof v.base === 'string' &&
    'head' in v &&
    typeof v.head === 'string' &&
    'changedPaths' in v &&
    Array.isArray(v.changedPaths) &&
    v.changedPaths.every(isChangedPath) &&
    'checks' in v &&
    Array.isArray(v.checks) &&
    v.checks.every(isCheckResult) &&
    'contractDelta' in v &&
    Array.isArray(v.contractDelta) &&
    v.contractDelta.every((x): x is string => typeof x === 'string') &&
    'decisions' in v &&
    isDecisionSummary(v.decisions) &&
    'blockers' in v &&
    Array.isArray(v.blockers) &&
    v.blockers.every((x): x is string => typeof x === 'string') &&
    'narrative' in v &&
    typeof v.narrative === 'string' &&
    'observedAt' in v &&
    typeof v.observedAt === 'string'
  )
}

function isWorkItemRef(v: unknown): v is WorkItemRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    'repoNodeId' in v &&
    typeof v.repoNodeId === 'string' &&
    'itemNodeId' in v &&
    typeof v.itemNodeId === 'string' &&
    'number' in v &&
    typeof v.number === 'number' &&
    'kind' in v &&
    (v.kind === 'issue' || v.kind === 'pr')
  )
}

function isChangedPath(v: unknown): v is ChangedPath {
  return (
    typeof v === 'object' &&
    v !== null &&
    'status' in v &&
    (v.status === 'A' || v.status === 'M' || v.status === 'D' || v.status === 'R' || v.status === 'C') &&
    'path' in v &&
    typeof v.path === 'string'
  )
}

function isCheckResult(v: unknown): v is CheckResult {
  return (
    typeof v === 'object' &&
    v !== null &&
    'name' in v &&
    typeof v.name === 'string' &&
    'checkRunId' in v &&
    typeof v.checkRunId === 'string' &&
    'attempt' in v &&
    typeof v.attempt === 'number' &&
    'conclusion' in v &&
    (v.conclusion === 'success' ||
      v.conclusion === 'failure' ||
      v.conclusion === 'neutral' ||
      v.conclusion === 'cancelled' ||
      v.conclusion === 'timed_out' ||
      v.conclusion === 'skipped' ||
      v.conclusion === 'pending')
  )
}

function isDecisionSummary(v: unknown): v is DecisionSummary {
  return (
    typeof v === 'object' &&
    v !== null &&
    'allowed' in v &&
    typeof v.allowed === 'number' &&
    'denied' in v &&
    typeof v.denied === 'number' &&
    'asked' in v &&
    typeof v.asked === 'number'
  )
}
