import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runner } from '../src/github'
import { drainAndRender } from '../src/hooks/inject'
import { writeBindings } from '../src/store'

let base: string
let root: string
const original = runner.run

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'dkm-workflow-hook-'))
  root = join(base, 'repo')
  const git = spawnSync('git', ['init', '-q', root], { encoding: 'utf8' })
  if (git.status !== 0) throw new Error(git.stderr)
  runner.run = () => {
    throw new Error('Local injection must not call GitHub')
  }
})
afterEach(() => {
  runner.run = original
  rmSync(base, { recursive: true, force: true })
})

test('feature-off injection is unchanged and has no workflow output or network', () => {
  expect(drainAndRender(root, 'fixture')).toBe('')
})

test('enabled bound workflow adds an actual local operating hint, not a model or poller', () => {
  mkdirSync(join(root, '.dkm'), { recursive: true })
  writeFileSync(join(root, '.dkm', 'workflow.toml'), 'version = 1\nenabled = true')
  writeBindings(root, {
    version: 1,
    bindings: [
      {
        worktreePath: root,
        bound: { repoNodeId: 'R_fixture', itemNodeId: 'I_fixture', number: 42, kind: 'issue' },
        followed: [],
        ambient: true
      }
    ]
  })
  const output = drainAndRender(root, 'fixture')
  expect(output).toContain('DKM optional workflow: #42')
  expect(output).toContain('never permission')
})

test('broken optional config surfaces a hint without swallowing normal coordination', () => {
  mkdirSync(join(root, '.dkm'), { recursive: true })
  writeFileSync(join(root, '.dkm', 'workflow.toml'), 'version = 99')
  expect(drainAndRender(root, 'fixture')).toContain('normal coordination continues')
})
