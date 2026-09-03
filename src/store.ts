import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type {
  Binding,
  BindingsFile,
  ChangedPath,
  CheckResult,
  CursorFile,
  DecisionRecord,
  DecisionSummary,
  EmittedState,
  LastEmitFile,
  PendingEvent,
  Receipt,
  ResumeTicket,
  RevivalRecord,
  WorkItemRef
} from './types'

const emptyBindings: BindingsFile = { version: 1, bindings: [] }
const emptyCursors: CursorFile = { version: 1, cursors: {} }
const emptyLastEmit: LastEmitFile = { version: 1, emitted: {} }

/**
 * State lives at the MAIN worktree's root, not the caller's. In a linked worktree `--show-toplevel`
 * returns that worktree, so resolving state from it would give every worktree a private .dkm/ and
 * silo exactly the bindings, cursors and decisions that are supposed to be shared between them.
 * `--git-common-dir` points at the shared .git for every worktree of a repository; its parent is the
 * main worktree root, and for a plain checkout it is simply the root itself.
 */
function dkmPath(root: string): string {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: 5000 })
  if (r.status !== 0 || typeof r.stdout !== 'string') return join(root, '.dkm')
  const common = r.stdout.trim()
  if (common.length === 0) return join(root, '.dkm')
  const absolute = isAbsolute(common) ? common : join(root, common)
  return join(dirname(absolute), '.dkm')
}

function atomicWrite(target: string, data: string): void {
  const dir = dirname(target)
  const tmp = join(dir, `${randomUUID()}.tmp`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(tmp, data)
  renameSync(tmp, target)
}

function readJson<T>(root: string, relative: string, guard: (v: unknown) => v is T, fallback: T): T {
  const target = join(dkmPath(root), relative)
  try {
    const raw = readFileSync(target, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return guard(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(root: string, relative: string, value: T): void {
  const target = join(dkmPath(root), relative)
  atomicWrite(target, JSON.stringify(value))
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

function isBinding(v: unknown): v is Binding {
  return (
    typeof v === 'object' &&
    v !== null &&
    'worktreePath' in v &&
    typeof v.worktreePath === 'string' &&
    'bound' in v &&
    (v.bound === null || isWorkItemRef(v.bound)) &&
    'followed' in v &&
    Array.isArray(v.followed) &&
    v.followed.every(isWorkItemRef) &&
    'ambient' in v &&
    typeof v.ambient === 'boolean'
  )
}

function isBindingsFile(v: unknown): v is BindingsFile {
  return (
    typeof v === 'object' &&
    v !== null &&
    'version' in v &&
    v.version === 1 &&
    'bindings' in v &&
    Array.isArray(v.bindings) &&
    v.bindings.every(isBinding)
  )
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null) return false
  const record = v as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (typeof value !== 'string') return false
  }
  return true
}

function isCursorFile(v: unknown): v is CursorFile {
  return (
    typeof v === 'object' &&
    v !== null &&
    'version' in v &&
    v.version === 1 &&
    'cursors' in v &&
    isStringRecord(v.cursors)
  )
}

function isEmittedState(v: unknown): v is EmittedState {
  return (
    typeof v === 'object' &&
    v !== null &&
    'head' in v &&
    typeof v.head === 'string' &&
    'blockers' in v &&
    Array.isArray(v.blockers) &&
    v.blockers.every((x): x is string => typeof x === 'string') &&
    'checksFingerprint' in v &&
    typeof v.checksFingerprint === 'string' &&
    'commentId' in v &&
    typeof v.commentId === 'string'
  )
}

function isEmittedRecord(v: unknown): v is Record<string, EmittedState> {
  if (typeof v !== 'object' || v === null) return false
  const record = v as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (!isEmittedState(value)) return false
  }
  return true
}

function isLastEmitFile(v: unknown): v is LastEmitFile {
  return (
    typeof v === 'object' &&
    v !== null &&
    'version' in v &&
    v.version === 1 &&
    'emitted' in v &&
    isEmittedRecord(v.emitted)
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

function isPendingEvent(v: unknown): v is PendingEvent {
  return (
    typeof v === 'object' &&
    v !== null &&
    'eventId' in v &&
    typeof v.eventId === 'string' &&
    'rootId' in v &&
    typeof v.rootId === 'string' &&
    'hops' in v &&
    typeof v.hops === 'number' &&
    'tier' in v &&
    (v.tier === 'bound' || v.tier === 'followed' || v.tier === 'ambient') &&
    'workItem' in v &&
    isWorkItemRef(v.workItem) &&
    'observedAt' in v &&
    typeof v.observedAt === 'string' &&
    'headline' in v &&
    typeof v.headline === 'string' &&
    'url' in v &&
    typeof v.url === 'string' &&
    'receipt' in v &&
    (v.receipt === null || isReceipt(v.receipt))
  )
}

function isDecisionRecord(v: unknown): v is DecisionRecord {
  return (
    typeof v === 'object' &&
    v !== null &&
    'ts' in v &&
    typeof v.ts === 'string' &&
    'session' in v &&
    typeof v.session === 'string' &&
    'tool' in v &&
    typeof v.tool === 'string' &&
    'summary' in v &&
    typeof v.summary === 'string' &&
    'decision' in v &&
    (v.decision === 'allow' || v.decision === 'deny' || v.decision === 'ask') &&
    'rule' in v &&
    typeof v.rule === 'string' &&
    'reverse' in v &&
    typeof v.reverse === 'string'
  )
}

export function readBindings(root: string): BindingsFile {
  return readJson(root, 'bindings.json', isBindingsFile, emptyBindings)
}

export function writeBindings(root: string, f: BindingsFile): void {
  writeJson(root, 'bindings.json', f)
}

export function readCursors(root: string): CursorFile {
  return readJson(root, 'cursor.json', isCursorFile, emptyCursors)
}

export function writeCursors(root: string, f: CursorFile): void {
  writeJson(root, 'cursor.json', f)
}

export function readLastEmit(root: string): LastEmitFile {
  return readJson(root, 'last-emit.json', isLastEmitFile, emptyLastEmit)
}

export function writeLastEmit(root: string, f: LastEmitFile): void {
  writeJson(root, 'last-emit.json', f)
}

export function listPending(root: string): PendingEvent[] {
  const dir = join(dkmPath(root), 'pending')
  const out: PendingEvent[] = []
  try {
    const names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort()
    for (const name of names) {
      const p = join(dir, name)
      try {
        const raw = readFileSync(p, 'utf8')
        const parsed: unknown = JSON.parse(raw)
        if (isPendingEvent(parsed)) out.push(parsed)
      } catch {}
    }
  } catch {
    return out
  }
  return out
}

export function writePending(root: string, e: PendingEvent): void {
  if (e.eventId.includes('/') || e.eventId.includes('..')) {
    throw new Error('invalid eventId')
  }
  writeJson(root, join('pending', `${e.eventId}.json`), e)
}

export function drainPending(root: string): PendingEvent[] {
  const dir = join(dkmPath(root), 'pending')
  const out: PendingEvent[] = []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const p = join(dir, name)
    try {
      const raw = readFileSync(p, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!isPendingEvent(parsed)) continue
      unlinkSync(p)
      out.push(parsed)
    } catch {}
  }
  return out
}

export function appendDecision(root: string, rec: DecisionRecord): void {
  mkdirSync(dkmPath(root), { recursive: true })
  appendFileSync(join(dkmPath(root), 'decisions.jsonl'), `${JSON.stringify(rec)}\n`, 'utf8')
}

/**
 * The revival log is separate from `decisions.jsonl` on purpose. A decision records what an agent
 * was allowed to do; this records why a run paused and when it came back, which is operational
 * history and must not dilute the permission audit the human reads.
 */
export function writeResumeTicket(root: string, ticket: ResumeTicket): void {
  mkdirSync(dkmPath(root), { recursive: true })
  atomicWrite(join(dkmPath(root), 'last-session.json'), JSON.stringify(ticket))
}

export function readResumeTicket(root: string): ResumeTicket | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dkmPath(root), 'last-session.json'), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const t = parsed as Record<string, unknown>
    if (typeof t.sessionId !== 'string' || typeof t.cwd !== 'string') return null
    return {
      sessionId: t.sessionId,
      cwd: t.cwd,
      reason: typeof t.reason === 'string' ? t.reason : 'unknown',
      endedAt: typeof t.endedAt === 'string' ? t.endedAt : ''
    }
  } catch {
    return null
  }
}

export function appendRevival(root: string, rec: RevivalRecord): void {
  mkdirSync(dkmPath(root), { recursive: true })
  appendFileSync(join(dkmPath(root), 'revivals.jsonl'), `${JSON.stringify(rec)}\n`, 'utf8')
}

export function readDecisions(root: string): DecisionRecord[] {
  const target = join(dkmPath(root), 'decisions.jsonl')
  const out: DecisionRecord[] = []
  try {
    const raw = readFileSync(target, 'utf8')
    const lines = raw.split('\n')
    for (const line of lines) {
      if (line === '') continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (isDecisionRecord(parsed)) out.push(parsed)
      } catch {}
    }
  } catch {
    return out
  }
  return out
}
