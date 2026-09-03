import { afterEach, beforeEach, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendDecision,
  drainPending,
  listPending,
  readBindings,
  readCursors,
  readDecisions,
  readLastEmit,
  writeBindings,
  writeCursors,
  writeLastEmit,
  writePending
} from './store'
import type {
  Binding,
  BindingsFile,
  CursorFile,
  DecisionRecord,
  EmittedState,
  LastEmitFile,
  PendingEvent,
  Receipt,
  WorkItemRef
} from './types'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dkm-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const emptyBindings: BindingsFile = { version: 1, bindings: [] }
const emptyCursors: CursorFile = { version: 1, cursors: {} }
const emptyLastEmit: LastEmitFile = { version: 1, emitted: {} }

function sampleWorkItem(): WorkItemRef {
  return { repoNodeId: 'R_1', itemNodeId: 'I_1', number: 1, kind: 'issue' as const }
}

function sampleReceipt(): Receipt {
  return {
    eventId: 'e1',
    workItem: sampleWorkItem(),
    base: 'abc',
    head: 'def',
    changedPaths: [{ status: 'A' as const, path: 'src/foo.ts' }],
    checks: [{ name: 'ci', checkRunId: 'c1', attempt: 1, conclusion: 'success' as const }],
    contractDelta: ['src/foo.ts'],
    decisions: { allowed: 0, denied: 0, asked: 0 },
    blockers: [],
    narrative: '',
    observedAt: '2026-09-03T00:00:00Z'
  }
}

function samplePending(eventId: string, receipt: Receipt | null = null): PendingEvent {
  return {
    eventId,
    rootId: 'r1',
    hops: 0,
    tier: 'bound' as const,
    workItem: sampleWorkItem(),
    observedAt: '2026-09-03T00:00:00Z',
    headline: 'h',
    url: 'https://example.com',
    receipt
  }
}

function sampleBinding(): Binding {
  return {
    worktreePath: 'worktrees/wt',
    bound: sampleWorkItem(),
    followed: [],
    ambient: false
  }
}

function sampleEmit(): EmittedState {
  return { head: 'abc', blockers: [], checksFingerprint: 'f', commentId: 'c1' }
}

function sampleCursor(): CursorFile {
  return { version: 1, cursors: { repo1: 'cursor1' } }
}

function sampleLastEmit(): LastEmitFile {
  return { version: 1, emitted: { item1: sampleEmit() } }
}

function sampleDecision(id: string): DecisionRecord {
  return {
    ts: '2026-09-03T00:00:00Z',
    session: `s-${id}`,
    tool: 'Bash',
    summary: `test ${id}`,
    decision: 'allow',
    rule: 'policy.allow.commands[0]',
    reverse: 'n/a'
  }
}

function allDkmFiles(root: string): string[] {
  const dkm = join(root, '.dkm')
  const out: string[] = []
  function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dkm)
  return out
}

test('readers return empty defaults for missing files', () => {
  expect(readBindings(tmpDir)).toEqual(emptyBindings)
  expect(readCursors(tmpDir)).toEqual(emptyCursors)
  expect(readLastEmit(tmpDir)).toEqual(emptyLastEmit)
  expect(listPending(tmpDir)).toEqual([])
  expect(drainPending(tmpDir)).toEqual([])
  expect(readDecisions(tmpDir)).toEqual([])
})

test('readers fall back to defaults on corrupt json', () => {
  mkdirSync(join(tmpDir, '.dkm', 'pending'), { recursive: true })
  writeFileSync(join(tmpDir, '.dkm', 'bindings.json'), 'not json')
  writeFileSync(join(tmpDir, '.dkm', 'cursor.json'), 'not json')
  writeFileSync(join(tmpDir, '.dkm', 'last-emit.json'), 'not json')
  writeFileSync(join(tmpDir, '.dkm', 'pending', 'bad.json'), 'not json')
  writeFileSync(join(tmpDir, '.dkm', 'decisions.jsonl'), 'not json\n')

  expect(readBindings(tmpDir)).toEqual(emptyBindings)
  expect(readCursors(tmpDir)).toEqual(emptyCursors)
  expect(readLastEmit(tmpDir)).toEqual(emptyLastEmit)
  expect(listPending(tmpDir)).toEqual([])
  expect(drainPending(tmpDir)).toEqual([])
  expect(readDecisions(tmpDir)).toEqual([])
})

test('writers create .dkm and overwrite atomically', () => {
  const first: BindingsFile = { version: 1, bindings: [] }
  writeBindings(tmpDir, first)

  const second: BindingsFile = { version: 1, bindings: [sampleBinding()] }
  writeBindings(tmpDir, second)
  expect(readBindings(tmpDir)).toEqual(second)

  const cursors = sampleCursor()
  writeCursors(tmpDir, cursors)
  expect(readCursors(tmpDir)).toEqual(cursors)

  const lastEmit = sampleLastEmit()
  writeLastEmit(tmpDir, lastEmit)
  expect(readLastEmit(tmpDir)).toEqual(lastEmit)

  const pending = samplePending('p1')
  writePending(tmpDir, pending)
  expect(listPending(tmpDir)).toEqual([pending])

  const decision = sampleDecision('1')
  appendDecision(tmpDir, decision)
  expect(readDecisions(tmpDir)).toEqual([decision])

  for (const file of allDkmFiles(tmpDir)) {
    expect(file.endsWith('.tmp')).toBe(false)
  }
})

test('a pending event carrying a full receipt round-trips', () => {
  const pending = { ...samplePending('r1'), receipt: sampleReceipt() }
  writePending(tmpDir, pending)
  expect(listPending(tmpDir)).toEqual([pending])
})

test('pending list is sorted and drain removes only parsed files', () => {
  const a = samplePending('a')
  const b = samplePending('b')
  writePending(tmpDir, b)
  writePending(tmpDir, a)
  expect(listPending(tmpDir)).toEqual([a, b])

  const drained = drainPending(tmpDir)
  expect(drained).toEqual([a, b])
  expect(listPending(tmpDir)).toEqual([])
  expect(drainPending(tmpDir)).toEqual([])
})

test('drain leaves unparseable pending files behind', () => {
  const a = samplePending('a')
  writePending(tmpDir, a)
  mkdirSync(join(tmpDir, '.dkm', 'pending'), { recursive: true })
  writeFileSync(join(tmpDir, '.dkm', 'pending', 'bad.json'), 'not json')

  const drained = drainPending(tmpDir)
  expect(drained).toEqual([a])
  expect(listPending(tmpDir)).toEqual([])
  expect(existsSync(join(tmpDir, '.dkm', 'pending', 'bad.json'))).toBe(true)
  expect(existsSync(join(tmpDir, '.dkm', 'pending', 'a.json'))).toBe(false)
})

test('writePending rejects path-traversal eventIds', () => {
  expect(() => writePending(tmpDir, samplePending('a/b'))).toThrow()
  expect(() => writePending(tmpDir, samplePending('a..b'))).toThrow()
  expect(() => writePending(tmpDir, samplePending('../x'))).toThrow()
})

test('decisions jsonl append and skip bad lines', () => {
  const d1 = sampleDecision('1')
  const d2 = sampleDecision('2')
  appendDecision(tmpDir, d1)
  appendDecision(tmpDir, d2)
  expect(readDecisions(tmpDir)).toEqual([d1, d2])

  const target = join(tmpDir, '.dkm', 'decisions.jsonl')
  appendFileSync(target, 'not json\n')
  expect(readDecisions(tmpDir)).toEqual([d1, d2])
})
