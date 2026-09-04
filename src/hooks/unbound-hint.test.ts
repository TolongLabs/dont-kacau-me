import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unboundHint } from './inject'

let tmpDir: string

function policy(): void {
  writeFileSync(join(tmpDir, '.dkm', 'policy.toml'), 'version = 1\n')
}

function bindings(bound: unknown): void {
  writeFileSync(
    join(tmpDir, '.dkm', 'bindings.json'),
    JSON.stringify({ version: 1, bindings: [{ worktreePath: tmpDir, bound, followed: [], ambient: true }] })
  )
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dkm-sessionstart-'))
  mkdirSync(join(tmpDir, '.dkm'), { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test('an unbound worktree with a policy is told how to bind', () => {
  policy()
  bindings(null)
  expect(unboundHint(tmpDir)).toContain('dkm-bind')
})

test('a worktree with no bindings file at all is still told how to bind', () => {
  // The first session in a repository has no bindings.json, which is exactly when the hint matters.
  policy()
  expect(unboundHint(tmpDir)).toContain('dkm-bind')
})

test('a bound worktree is not nagged', () => {
  policy()
  bindings({ repoNodeId: 'R_1', itemNodeId: 'I_1', number: 1, kind: 'issue' })
  expect(unboundHint(tmpDir)).toBe('')
})

test('a repository with no policy stays silent', () => {
  // Nobody opted this repository in. DKM must not advertise itself into it.
  bindings(null)
  expect(unboundHint(tmpDir)).toBe('')
})
