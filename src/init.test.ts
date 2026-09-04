import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decide } from './decide'
import { type Check, gitCheck, runInit, suggestPolicy } from './init'
import { loadPolicy } from './policy'
import type { DecisionInput } from './types'

const CHECKS: Check[] = [{ name: 'bun', ok: true, detail: '1.0.0' }]

let tmpDir: string

function input(toolName: string, toolInput: unknown): DecisionInput {
  return { sessionId: 's1', cwd: tmpDir, worktreePath: tmpDir, toolName, toolInput }
}

function verdict(toolName: string, toolInput: unknown): string {
  return decide(input(toolName, toolInput), loadPolicy(tmpDir)).decision
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dkm-init-'))
  mkdirSync(join(tmpDir, 'src'), { recursive: true })
  mkdirSync(join(tmpDir, 'docs'), { recursive: true })
  writeFileSync(join(tmpDir, 'bun.lock'), '')
  writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'bun test', lint: 'biome check .' } }))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test('the generated policy parses and grants exactly what init advertises', () => {
  // Asserted through loadPolicy and decide rather than by reading the TOML back, because a
  // generated file that only satisfies its own generator would pass while the parser rejected it.
  runInit(tmpDir, false, CHECKS)

  expect(verdict('Read', { file_path: join(tmpDir, 'src/a.ts') })).toBe('allow')
  expect(verdict('Bash', { command: 'bun test' })).toBe('allow')
  expect(verdict('Bash', { command: 'bun run lint' })).toBe('allow')
  expect(verdict('Write', { file_path: join(tmpDir, 'src/a.ts') })).toBe('allow')
  expect(verdict('Edit', { file_path: join(tmpDir, 'docs/a.md') })).toBe('allow')
})

test('the generated policy still lets the dangerous things reach the human', () => {
  runInit(tmpDir, false, CHECKS)

  expect(verdict('Edit', { file_path: join(tmpDir, 'package.json') })).toBe('ask')
  expect(verdict('Edit', { file_path: join(tmpDir, '.dkm/policy.toml') })).toBe('ask')
  expect(verdict('Bash', { command: 'git push' })).toBe('ask')
  expect(verdict('Write', { file_path: '/etc/passwd' })).toBe('deny')
})

test('a command the repository does not define is not granted', () => {
  // The scripts block has no typecheck, so granting one would be inventing a decision.
  runInit(tmpDir, false, CHECKS)
  expect(verdict('Bash', { command: 'bun run typecheck' })).toBe('ask')
})

test('only directories that exist are granted', () => {
  const policy = suggestPolicy(tmpDir)
  expect(policy).toContain('"src/**"')
  expect(policy).toContain('"docs/**"')
  expect(policy).not.toContain('"lib/**"')
  expect(policy).not.toContain('"tests/**"')
})

test('an existing policy is never replaced without --force', () => {
  // The file is the human grant. Silently rewriting it would widen or narrow authority nobody
  // decided to change.
  const target = join(tmpDir, '.dkm', 'policy.toml')
  mkdirSync(join(tmpDir, '.dkm'), { recursive: true })
  writeFileSync(target, 'version = 1\n')

  const result = runInit(tmpDir, false, CHECKS)
  expect(result.wrote).toBe(false)
  expect(readFileSync(target, 'utf8')).toBe('version = 1\n')

  expect(runInit(tmpDir, true, CHECKS).wrote).toBe(true)
  expect(readFileSync(target, 'utf8')).not.toBe('version = 1\n')
})

test('init reports where the policy landed', () => {
  const result = runInit(tmpDir, false, CHECKS)
  expect(existsSync(join(tmpDir, '.dkm', 'policy.toml'))).toBe(true)
  expect(result.output).toContain('policy.toml')
  expect(result.output).toContain('dkm-bind')
})

test('init points at a worktree, never a second session in the same directory', () => {
  // Recipients are keyed on worktree path and draining unlinks the event, so two sessions in one
  // directory share a queue and race for it. Telling a new user to open a second session there
  // would be telling them to lose events.
  const { output } = runInit(tmpDir, false, CHECKS)
  expect(output).toContain('git worktree add')
  expect(output).toContain('race')
})

test('a repository with no git is told to run git init', () => {
  const bare = mkdtempSync(join(tmpdir(), 'dkm-nogit-'))
  try {
    const git = gitCheck(bare)
    expect(git.ok).toBe(false)
    expect(git.detail).toContain('git init')
  } finally {
    rmSync(bare, { recursive: true, force: true })
  }
})
