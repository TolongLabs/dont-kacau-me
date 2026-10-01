import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { writeBindings } from '../src/store'

let base: string
let root: string
const cli = resolve(import.meta.dir, '../src/cli.ts')
const item = { repoNodeId: 'R_fixture', itemNodeId: 'I_fixture', number: 42, kind: 'issue' as const }

function run(args: string[], input?: string) {
  return spawnSync('bun', [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'workflow-cli-fixture' }
  })
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'dkm-workflow-cli-'))
  root = join(base, 'repo')
  const made = spawnSync('git', ['init', '-q', '-b', 'main', root], { encoding: 'utf8' })
  if (made.status !== 0) throw new Error(made.stderr)
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

test('workflow init is explicit, writes a disabled template and never overwrites an existing contract', () => {
  const got = run(['workflow', 'init'])
  expect(got.status).toBe(0)
  expect(got.stdout).toContain('disabled')
  const path = join(root, '.dkm', 'workflow.toml')
  expect(readFileSync(path, 'utf8')).toContain('enabled = false')
  writeFileSync(path, 'version = 1\nenabled = true')
  expect(run(['workflow', 'init']).status).toBe(1)
  expect(readFileSync(path, 'utf8')).toBe('version = 1\nenabled = true')
})

test('feature-off status is local and does not require a GitHub binding', () => {
  const got = run(['workflow', 'status'])
  expect(got.status).toBe(0)
  expect(got.stdout).toContain('disabled')
})

test('enabled workflow requires an explicit bound work item instead of guessing a branch name', () => {
  mkdirSync(join(root, '.dkm'), { recursive: true })
  writeFileSync(join(root, '.dkm', 'workflow.toml'), 'version = 1\nenabled = true')
  const got = run(['workflow', 'render'])
  expect(got.status).toBe(1)
  expect(got.stderr).toContain('Bind this worktree')
})

test('render displays an enabled local workflow without touching GitHub', () => {
  mkdirSync(join(root, '.dkm'), { recursive: true })
  writeFileSync(join(root, '.dkm', 'workflow.toml'), 'version = 1\nenabled = true')
  writeBindings(root, { version: 1, bindings: [{ worktreePath: root, bound: item, followed: [], ambient: true }] })
  const got = run(['workflow', 'render'])
  expect(got.status).toBe(0)
  expect(got.stdout).toContain('Intake Verdicts for #42')
})

test('unknown workflow commands/options and missing structured input are rejected', () => {
  expect(run(['workflow', 'secret-approve']).status).toBe(1)
  expect(run(['workflow', 'init', '--approve']).status).toBe(1)
  mkdirSync(join(root, '.dkm'), { recursive: true })
  writeFileSync(join(root, '.dkm', 'workflow.toml'), 'version = 1\nenabled = true')
  writeBindings(root, { version: 1, bindings: [{ worktreePath: root, bound: item, followed: [], ambient: true }] })
  expect(run(['workflow', 'record']).status).toBe(1)
  expect(run(['workflow', 'record', '--input', '-'], '{not json').status).toBe(1)
})

test('existing CLI status still operates when the optional workflow is not configured', () => {
  const got = run(['status'])
  expect(got.status).toBe(0)
  expect(got.stdout).toContain('bound')
  expect(got.stdout).not.toContain('workflow')
})
