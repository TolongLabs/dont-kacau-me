import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runner } from '../github'
import { renderReceipt } from '../receipt'
import type { Receipt, WorkItemRef } from '../types'
import { ingest } from './inject'

const item: WorkItemRef = { repoNodeId: 'R_1', itemNodeId: 'I_7', number: 7, kind: 'issue' }

const receipt: Receipt = {
  eventId: 'ev-1',
  workItem: item,
  base: '1111111111111111111111111111111111111111',
  head: '2222222222222222222222222222222222222222',
  changedPaths: [{ status: 'M', path: 'src/types.ts' }],
  checks: [],
  contractDelta: ['src/types.ts'],
  decisions: { allowed: 0, denied: 0, asked: 0 },
  blockers: [],
  narrative: '',
  observedAt: '2026-09-03T00:00:00Z'
}

const issueList = JSON.stringify([
  {
    node_id: 'I_7',
    number: 7,
    title: 'Contract owner',
    html_url: 'https://github.com/owner/repo/issues/7',
    updated_at: '2026-09-03T02:00:00Z'
  }
])

let tmpDir: string
let argvs: string[][]
const originalRun = runner.run

function bindings(root: string, paths: string[]): void {
  writeFileSync(
    join(root, '.dkm', 'bindings.json'),
    JSON.stringify({
      version: 1,
      bindings: paths.map((p, i) => ({
        worktreePath: p,
        bound: i === 0 ? item : null,
        followed: i === 0 ? [] : [item],
        ambient: true
      }))
    })
  )
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dkm-inject-'))
  writeFileSync(join(tmpDir, 'x'), 'x')
  require('node:fs').mkdirSync(join(tmpDir, '.dkm'), { recursive: true })
  argvs = []
  runner.run = (_root, argv) => {
    argvs.push(argv)
    const path = argv[1] ?? ''
    if (path.includes('/issues?since=')) return { ok: true, stdout: issueList, stderr: '' }
    if (path.endsWith('/comments')) {
      return { ok: true, stdout: JSON.stringify([{ id: 1, body: renderReceipt(receipt) }]), stderr: '' }
    }
    return { ok: true, stdout: '[]', stderr: '' }
  }
})

afterEach(() => {
  runner.run = originalRun
  rmSync(tmpDir, { recursive: true, force: true })
})

function commentCalls(): number {
  return argvs.filter((a) => (a[1] ?? '').endsWith('/comments')).length
}

test('one receipt is fetched once however many worktrees receive it', () => {
  // Queueing per recipient must not multiply the network cost by the number of worktrees. At
  // roughly 1s per gh call against a live repository, four worktrees would be most of the timeout.
  bindings(tmpDir, [tmpDir, '/wt/b', '/wt/c', '/wt/d'])
  ingest(tmpDir)
  expect(commentCalls()).toBe(1)
})

function issueListCalls(): number {
  return argvs.filter((a) => (a[1] ?? '').includes('/issues?since=')).length
}

test('a budget already spent stops ingest before it fetches anything', () => {
  bindings(tmpDir, [tmpDir, '/wt/b'])
  let clock = 0
  ingest(tmpDir, 0, 10, () => {
    clock += 1000
    return clock
  })
  expect(issueListCalls()).toBe(0)
})

test('a budget spent mid-ingest degrades to headlines rather than overrunning the hook', () => {
  // The clock is inside the allowance for the repository check and past it by the time receipts
  // would be fetched, so this reaches the receipt guard specifically. A test whose clock expires
  // earlier passes on the loop break instead and proves nothing about it.
  bindings(tmpDir, [tmpDir, '/wt/b'])
  const readings = [0, 0]
  ingest(tmpDir, 0, 100, () => readings.shift() ?? 99_999)
  expect(issueListCalls()).toBe(1)
  expect(commentCalls()).toBe(0)
})

test('within budget the receipt is still fetched', () => {
  bindings(tmpDir, [tmpDir, '/wt/b'])
  ingest(tmpDir, 0, 8000, () => 0)
  expect(commentCalls()).toBe(1)
})
