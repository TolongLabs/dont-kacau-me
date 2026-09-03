import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cliPath = join(here, '..', 'src', 'cli.ts')
const fakeGhPath = join(here, 'fake-gh.ts')

type Fixture = Record<string, { stdout: string; stderr?: string; status?: number }[]>

const issue = JSON.stringify({ id: 'I_7', number: 7, isPr: false })
const repoId = 'R_1'

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'dkm-cli-'))
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: root })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: root })
  writeFileSync(join(root, 'a.txt'), 'a')
  spawnSync('git', ['add', '-A'], { cwd: root })
  spawnSync('git', ['commit', '-qm', 'one'], { cwd: root })
  return root
}

function envFor(root: string, fixture: Fixture): Record<string, string> {
  const binDir = join(root, 'bin')
  mkdirSync(binDir, { recursive: true })
  const shim = join(binDir, 'gh')
  writeFileSync(shim, '#!/bin/sh\nexec bun "$FAKE_GH_SCRIPT" "$@"\n')
  chmodSync(shim, 0o755)
  const fixturePath = join(root, 'fixture.json')
  writeFileSync(fixturePath, JSON.stringify(fixture))
  return {
    FAKE_GH_SCRIPT: fakeGhPath,
    FAKE_GH_FIXTURE: fixturePath,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    HOME: process.env.HOME ?? '',
    CLAUDE_CODE_SESSION_ID: 'sess-1'
  }
}

function cli(root: string, args: string[], env: Record<string, string>) {
  return spawnSync('bun', [cliPath, ...args], { cwd: root, env, encoding: 'utf8', timeout: 10000 })
}

const resolvable: Fixture = {
  'issue-get': [{ stdout: issue }, { stdout: issue }],
  'repo-view': [{ stdout: repoId }, { stdout: repoId }]
}

test('status on a fresh repository reports nothing bound', () => {
  const root = makeRepo()
  try {
    const r = cli(root, ['status'], envFor(root, {}))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('bound     (none)')
    expect(r.stdout).toContain('pending   0 undelivered')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('bind records the work item and status reflects it', () => {
  const root = makeRepo()
  try {
    const env = envFor(root, resolvable)
    expect(cli(root, ['bind', '7'], env).stdout).toContain('issue #7')
    const bindings = JSON.parse(readFileSync(join(root, '.dkm', 'bindings.json'), 'utf8'))
    expect(bindings.bindings[0].bound.number).toBe(7)
    expect(cli(root, ['status'], envFor(root, {})).stdout).toContain('issue #7')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('follow is idempotent', () => {
  const root = makeRepo()
  try {
    const env = envFor(root, {
      'issue-get': [{ stdout: issue }, { stdout: issue }],
      'repo-view': [{ stdout: repoId }, { stdout: repoId }]
    })
    expect(cli(root, ['follow', '7'], env).stdout).toContain('following issue #7')
    expect(cli(root, ['follow', '7'], env).stdout).toContain('already following')
    const bindings = JSON.parse(readFileSync(join(root, '.dkm', 'bindings.json'), 'utf8'))
    expect(bindings.bindings[0].followed).toHaveLength(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unresolvable work item fails loudly rather than binding to nothing', () => {
  const root = makeRepo()
  try {
    const r = cli(root, ['bind', '999'], envFor(root, { 'issue-get': [{ stdout: '', status: 1 }] }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('could not resolve #999')
    // The item is resolved before any state is touched, so a failed bind leaves no half-written
    // binding behind for the next run to trip over.
    expect(existsSync(join(root, '.dkm', 'bindings.json'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a non-numeric work item is rejected before any network call', () => {
  const root = makeRepo()
  try {
    const r = cli(root, ['bind', 'not-a-number'], envFor(root, {}))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('expected a work item number')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('note and blocker accumulate into the session report', () => {
  const root = makeRepo()
  try {
    const env = envFor(root, {})
    expect(cli(root, ['note', 'refactored', 'the', 'parser'], env).status).toBe(0)
    expect(cli(root, ['blocker', 'needs a human call'], env).status).toBe(0)
    const report = JSON.parse(readFileSync(join(root, '.dkm', 'report', 'sess-1.json'), 'utf8'))
    expect(report.narrative).toBe('refactored the parser')
    expect(report.blockers).toEqual(['needs a human call'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an empty note is rejected', () => {
  const root = makeRepo()
  try {
    expect(cli(root, ['note'], envFor(root, {})).status).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unknown command exits non-zero and names the valid ones', () => {
  const root = makeRepo()
  try {
    const r = cli(root, ['frobnicate'], envFor(root, {}))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('bind, follow, unfollow, note, blocker, revive, status')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('outside a git worktree the CLI refuses rather than writing somewhere arbitrary', () => {
  const bare = mkdtempSync(join(tmpdir(), 'dkm-nogit-'))
  try {
    const r = cli(bare, ['status'], envFor(bare, {}))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('not inside a git worktree')
    expect(existsSync(join(bare, '.dkm'))).toBe(false)
  } finally {
    rmSync(bare, { recursive: true, force: true })
  }
})
