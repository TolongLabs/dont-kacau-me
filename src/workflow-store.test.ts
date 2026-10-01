import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dkmPath } from './store'
import type { WorkItemRef } from './types'
import { loadWorkflowConfig, readWorkflow, updateWorkflow, workflowPath } from './workflow-store'

let base: string
let root: string
const item: WorkItemRef = { repoNodeId: 'R_fixture', itemNodeId: 'I_fixture', number: 1, kind: 'issue' }

function git(args: string[], cwd = root): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}

function config(text: string): void {
  mkdirSync(join(root, '.dkm'), { recursive: true })
  writeFileSync(join(root, '.dkm', 'workflow.toml'), text)
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'dkm-workflow-'))
  root = join(base, 'repo')
  git(['init', '-q', '-b', 'main', root], base)
  git(['config', 'user.email', 'fixture@example.invalid'])
  git(['config', 'user.name', 'Fixture'])
  writeFileSync(join(root, 'file.txt'), 'fixture')
  git(['add', 'file.txt'])
  git(['commit', '-qm', 'fixture'])
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

test('missing workflow config is disabled without creating state', () => {
  expect(loadWorkflowConfig(root).enabled).toBe(false)
  expect(loadWorkflowConfig(root).release.enabled).toBe(false)
  expect(existsSync(join(root, '.dkm'))).toBe(false)
})

test('the project contract is explicit and release publication stays separately off', () => {
  config('version = 1\nenabled = true\nverificationHints = ["bun test"]\n[release]\ntagPrefix = "v2-"\n')
  const got = loadWorkflowConfig(root)
  expect(got.enabled).toBe(true)
  expect(got.verificationHints).toEqual(['bun test'])
  expect(got.release).toEqual({ enabled: false, tagPrefix: 'v2-', targetBranch: 'main', requiredChecks: [] })
})

for (const raw of [
  'version = 9',
  'version = 1\nenabled = "true"',
  'version = 1\npermission = "allow"',
  'version = 1\n[release]\nrequiredChecks = [1]',
  'version = 1\n[release]\ntagPrefix = "--danger"'
]) {
  test(`invalid workflow config fails instead of changing authority: ${raw}`, () => {
    config(raw)
    expect(() => loadWorkflowConfig(root)).toThrow()
    expect(readFileSync(join(root, '.dkm', 'workflow.toml'), 'utf8')).toBe(raw)
  })
}

test('a guarded update is durable and stale revisions cannot overwrite it', () => {
  const initial = readWorkflow(root, item)
  expect(initial.revision).toBe(0)
  const saved = updateWorkflow(root, item, 0, (state) => {
    state.publication = { commentId: '12', fingerprint: 'fixture' }
  })
  expect(saved.revision).toBe(1)
  expect(readWorkflow(root, item).publication?.commentId).toBe('12')
  expect(() =>
    updateWorkflow(root, item, 0, (state) => {
      state.publication = null
    })
  ).toThrow(/changed/)
  expect(readWorkflow(root, item).publication?.commentId).toBe('12')
})

test('work item identity depends on field values, not object property order', () => {
  updateWorkflow(root, item, 0, () => {})
  const reordered: WorkItemRef = { kind: 'issue', number: 1, itemNodeId: 'I_fixture', repoNodeId: 'R_fixture' }
  expect(readWorkflow(root, reordered).revision).toBe(1)
  expect(() => readWorkflow(root, { ...reordered, number: 2 })).toThrow(/identity/)
})

test('corrupt state is not reset or overwritten', () => {
  const path = workflowPath(root, item)
  mkdirSync(join(dkmPath(root), 'workflows'), { recursive: true })
  writeFileSync(path, '{bad state')
  expect(() => readWorkflow(root, item)).toThrow(/Invalid workflow state/)
  expect(() => updateWorkflow(root, item, 0, () => {})).toThrow()
  expect(readFileSync(path, 'utf8')).toBe('{bad state')
})

test('a nested writer cannot silently erase the current update and the lock is released', () => {
  updateWorkflow(root, item, 0, (state) => {
    expect(() => updateWorkflow(root, item, 0, () => {})).toThrow(/busy/)
    state.publication = { commentId: 'kept', fingerprint: 'fixture' }
  })
  expect(readWorkflow(root, item).publication?.commentId).toBe('kept')
  expect(() => updateWorkflow(root, item, 1, () => {})).not.toThrow()
})

test('a failed change does not persist and releases its guard', () => {
  expect(() =>
    updateWorkflow(root, item, 0, () => {
      throw new Error('fixture failure')
    })
  ).toThrow('fixture failure')
  expect(readWorkflow(root, item).revision).toBe(0)
  expect(existsSync(workflowPath(root, item))).toBe(false)
  expect(() => updateWorkflow(root, item, 0, () => {})).not.toThrow()
})

test('explicit work items and repositories keep independent state', () => {
  updateWorkflow(root, item, 0, (state) => {
    state.publication = { commentId: 'first', fingerprint: 'fixture' }
  })
  const other = { ...item, itemNodeId: 'I_other', number: 2 }
  expect(readWorkflow(root, other).publication).toBeNull()
  const secondRoot = join(base, 'other')
  git(['init', '-q', secondRoot], base)
  expect(readWorkflow(secondRoot, item).publication).toBeNull()
})

test('linked worktrees share workflow config and records from the primary checkout', () => {
  config('version = 1\nenabled = true')
  const linked = join(base, 'linked')
  git(['worktree', 'add', '-q', '-b', 'fixture-feature', linked])
  mkdirSync(join(linked, '.dkm'), { recursive: true })
  writeFileSync(join(linked, '.dkm', 'workflow.toml'), 'version = 1\nenabled = false')
  expect(loadWorkflowConfig(linked).enabled).toBe(true)
  updateWorkflow(linked, item, 0, (state) => {
    state.publication = { commentId: 'shared', fingerprint: 'fixture' }
  })
  expect(readWorkflow(root, item).publication?.commentId).toBe('shared')
  expect(workflowPath(linked, item)).toBe(workflowPath(root, item))
})
