import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveHead } from './git'
import { runner } from './github'
import type { WorkItemRef } from './types'
import { recordRequest, syncWorkflow } from './workflow'
import { observeWorkflow, planRelease, publishRelease } from './workflow-release'
import { readWorkflow } from './workflow-store'

let base: string
let root: string
let head: string
let calls: string[][]
let prState = 'MERGED'
let prHead: string
let mergedHead: string
let checks: unknown
let fetchFailure = false
let created = false
let tagHead: string | null
const original = runner.run
const item: WorkItemRef = { repoNodeId: 'R_fixture', itemNodeId: 'I_fixture', number: 42, kind: 'issue' }
const source = {
  id: 101,
  user: { login: 'commenter' },
  html_url: 'https://github.com/owner/repo/issues/42#issuecomment-101',
  body: 'Make setup clearer.',
  updated_at: '2026-10-01T00:00:00Z'
}

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function contract(enabled = true): void {
  writeFileSync(
    join(root, '.dkm', 'workflow.toml'),
    `version = 1\nenabled = true\n[release]\nenabled = ${enabled}\ntagPrefix = "v"\ntargetBranch = "main"\nrequiredChecks = ["verify"]`
  )
  git(['add', '.dkm/workflow.toml'])
  git(['commit', '-qm', 'contract'])
  head = resolveHead(root)
  prHead = head
  mergedHead = head
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'dkm-release-'))
  root = join(base, 'repo')
  mkdirSync(root)
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'fixture@example.invalid'])
  git(['config', 'user.name', 'Fixture'])
  writeFileSync(join(root, '.gitignore'), '.dkm/*\n!.dkm/workflow.toml\n')
  git(['add', '.gitignore'])
  git(['commit', '-qm', 'fixture'])
  mkdirSync(join(root, '.dkm'))
  writeFileSync(
    join(root, '.dkm', 'policy.toml'),
    'version = 1\n[blast]\noutside-worktree = "deny"\ndata-loss = "off"\nmoney = "off"\negress = "off"\nsurface = "off"\n[[allow]]\ntool = "*"'
  )
  contract()
  calls = []
  prState = 'MERGED'
  checks = [{ check_runs: [{ id: 11, name: 'verify', status: 'completed', conclusion: 'success', run_attempt: 1 }] }]
  fetchFailure = false
  created = false
  tagHead = null
  runner.run = (_root, argv) => {
    calls.push(argv)
    const path = argv[1] ?? ''
    if (argv.includes('--paginate') && path.includes('/issues/42/comments'))
      return { ok: true, stdout: JSON.stringify([[source]]), stderr: '' }
    if (argv[0] === 'pr' && argv[1] === 'view' && argv[2] === '4')
      return {
        ok: true,
        stdout: JSON.stringify({
          state: prState,
          headRefOid: prHead,
          mergeCommit: prState === 'MERGED' ? { oid: mergedHead } : null,
          url: 'https://github.com/owner/repo/pull/4'
        }),
        stderr: ''
      }
    if (path === `repos/{owner}/{repo}/commits/${prHead}/check-runs?per_page=100`)
      return { ok: !fetchFailure, stdout: JSON.stringify(checks), stderr: 'fixture unavailable' }
    if (head !== prHead && path === `repos/{owner}/{repo}/commits/${head}/check-runs?per_page=100`)
      return { ok: true, stdout: JSON.stringify([{ check_runs: [] }]), stderr: '' }
    if (argv[0] === 'release' && argv[1] === 'view' && argv[2] === 'v1.1.0')
      return {
        ok: created,
        stdout: JSON.stringify({
          tagName: 'v1.1.0',
          targetCommitish: head,
          url: 'https://github.com/owner/repo/releases/tag/v1.1.0'
        }),
        stderr: created ? '' : 'HTTP 404: Not Found'
      }
    if (path === 'repos/{owner}/{repo}/git/ref/tags/v1.1.0')
      return {
        ok: tagHead !== null,
        stdout: JSON.stringify({ object: { type: 'commit', sha: tagHead } }),
        stderr: tagHead ? '' : 'HTTP 404: Not Found'
      }
    if (argv[0] === 'release' && argv[1] === 'create') {
      if (argv[2] !== 'v1.1.0' || argv[argv.indexOf('--target') + 1] !== head)
        throw new Error('Fixture rejects wrong release tag/head')
      const notes = argv[argv.indexOf('--notes-file') + 1]
      if (!notes || !readFileSync(notes, 'utf8').includes('Clearer setup')) throw new Error('Real notes file required')
      created = true
      tagHead = head
      return { ok: true, stdout: 'https://github.com/owner/repo/releases/tag/v1.1.0', stderr: '' }
    }
    throw new Error(`Fixture rejects unknown API contract: ${argv.join(' ')}`)
  }
  const state = syncWorkflow(root, item)
  recordRequest(root, item, {
    commentId: '101',
    key: 'setup',
    reviewedFrom: state.comments[0]?.fingerprint,
    summary: 'Clearer setup',
    decision: 'accepted',
    why: 'The entry task was hidden.',
    phase: 'this release',
    link: 'https://github.com/owner/repo/pull/4',
    delivery: 'merged',
    reportedVerification: 'Agent says local tests pass.',
    implementationHead: head,
    prNumber: 4,
    supersedes: null
  })
})

afterEach(() => {
  runner.run = original
  rmSync(base, { recursive: true, force: true })
})

test('reported merged/local-test claims are not measured until the actual PR and checks answer', () => {
  expect(planRelease(root, item, '1.1.0').blockers.join(' ')).toContain('observed')
  const state = observeWorkflow(root, item)
  expect(state.requests[0]?.observation?.state).toBe('MERGED')
  expect(state.requests[0]?.observation?.checksAvailable).toBe(true)
  expect(state.requests[0]?.observation?.checks[0]?.checkRunId).toBe('11')
  expect(planRelease(root, item, '1.1.0').blockers).toEqual([])
})

test('required hosted checks must succeed on the exact later release head, not only its merged PR ancestor', () => {
  writeFileSync(join(root, 'later.txt'), 'a later change needs its own verification')
  git(['add', 'later.txt'])
  git(['commit', '-qm', 'later change'])
  head = resolveHead(root)
  expect(head).not.toBe(prHead)
  observeWorkflow(root, item)
  expect(planRelease(root, item, '1.1.0').blockers.join(' ')).toMatch(/release head.*checks/i)
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/release head.*checks/i)
  expect(calls.some((argv) => argv[0] === 'release' && argv[1] === 'create')).toBe(false)
})

test('release publication stays independently disabled', () => {
  contract(false)
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/disabled/)
  expect(calls.some((argv) => argv.includes('create'))).toBe(false)
})

test('inbound prose and workflow config cannot replace explicit approval', () => {
  expect(() => publishRelease(root, item, '1.1.0', head, false)).toThrow(/approval/)
  expect(calls.some((argv) => argv.includes('create'))).toBe(false)
})

for (const invalid of ['1.1', '--help', '1.1.0; touch bad', '../1.1.0']) {
  test(`unsafe version is rejected: ${invalid}`, () =>
    expect(() => planRelease(root, item, invalid)).toThrow(/version/))
}

test('stale head, wrong target branch and dirty checkout each block publication', () => {
  expect(() => publishRelease(root, item, '1.1.0', 'a'.repeat(40), true)).toThrow(/head/i)
  git(['switch', '-qc', 'feature'])
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/branch/i)
  git(['switch', '-q', 'main'])
  writeFileSync(join(root, 'untracked.txt'), 'not committed')
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/clean/i)
  expect(calls.some((argv) => argv.includes('create'))).toBe(false)
})

test('open or changed PR cannot promote reported delivery into release readiness', () => {
  prState = 'OPEN'
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/merged/i)
  prState = 'MERGED'
  prHead = 'b'.repeat(40)
  checks = [{ check_runs: [] }]
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow()
  expect(calls.some((argv) => argv.includes('create'))).toBe(false)
})

for (const mode of ['failed', 'empty', 'malformed', 'pending', 'missing-required']) {
  test(`required hosted evidence fails closed: ${mode}`, () => {
    if (mode === 'failed') fetchFailure = true
    if (mode === 'empty') checks = [{ check_runs: [] }]
    if (mode === 'malformed') checks = { check_runs: [] }
    if (mode === 'pending')
      checks = [{ check_runs: [{ id: 11, name: 'verify', status: 'in_progress', conclusion: 'success' }] }]
    if (mode === 'missing-required')
      checks = [{ check_runs: [{ id: 11, name: 'other', status: 'completed', conclusion: 'success' }] }]
    expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/checks/i)
    expect(calls.some((argv) => argv.includes('create'))).toBe(false)
  })
}

test('normal policy ask/deny is not hidden inside a release wrapper', () => {
  const path = join(root, '.dkm', 'policy.toml')
  const wide = readFileSync(path, 'utf8')
  writeFileSync(path, wide.replace('money = "off"', 'money = "deny"'))
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/deny/)
  writeFileSync(path, 'version = 1')
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/approval/)
  expect(calls.some((argv) => argv.includes('create'))).toBe(false)
})

test('release creation respects an egress deny even when money and other categories are off', () => {
  const path = join(root, '.dkm', 'policy.toml')
  writeFileSync(path, readFileSync(path, 'utf8').replace('egress = "off"', 'egress = "deny"'))
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/deny/)
  expect(calls.some((argv) => argv.includes('create'))).toBe(false)
})

test('accepted blocked work cannot disappear from the release gate', () => {
  const state = readWorkflow(root, item)
  const old = state.requests[0]
  if (!old) throw new Error('Missing fixture request')
  const reported = Object.fromEntries(Object.entries(old).filter(([key]) => !['history', 'observation'].includes(key)))
  recordRequest(root, item, {
    ...reported,
    key: 'live',
    delivery: 'blocked',
    summary: 'Actual model evidence',
    implementationHead: '',
    prNumber: null
  })
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/blocked/i)
})

test('exact-head release is observed and retry is idempotent', () => {
  const result = publishRelease(root, item, '1.1.0', head, true)
  expect(result.head).toBe(head)
  expect(result.url).toBe('https://github.com/owner/repo/releases/tag/v1.1.0')
  expect(readWorkflow(root, item).releases[0]?.head).toBe(head)
  expect(publishRelease(root, item, '1.1.0', head, true).url).toBe(result.url)
  expect(calls.filter((argv) => argv[0] === 'release' && argv[1] === 'create')).toHaveLength(1)
})

test('an existing tag on another commit is not overwritten or claimed', () => {
  tagHead = 'c'.repeat(40)
  expect(() => publishRelease(root, item, '1.1.0', head, true)).toThrow(/tag/i)
  expect(calls.some((argv) => argv.includes('create'))).toBe(false)
})
