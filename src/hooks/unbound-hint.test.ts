import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { permissionModeHint, unboundHint } from './inject'

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

test('a session that answers its own prompts is told the policy is not consulted', () => {
  // The failure this catches is silent by construction: no prompts arrive, which looks exactly like
  // a policy working. A first run under --dangerously-skip-permissions recorded no decision at all.
  policy()
  expect(permissionModeHint(tmpDir, 'bypassPermissions')).toContain('bypassPermissions')
  expect(permissionModeHint(tmpDir, 'auto')).toContain('may never be consulted')
})

test('a mode that puts the question to the human is not warned about', () => {
  policy()
  expect(permissionModeHint(tmpDir, 'manual')).toBe('')
  expect(permissionModeHint(tmpDir, 'plan')).toBe('')
})

test('a mode DKM was not told about is not guessed at', () => {
  policy()
  expect(permissionModeHint(tmpDir, undefined)).toBe('')
})

test('a repository with no policy is not warned about its mode', () => {
  // Nobody opted this repository in, so its permission mode is not DKM's business.
  expect(permissionModeHint(tmpDir, 'bypassPermissions')).toBe('')
})
