import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_BLAST, loadPolicy } from './policy'

let tmpDir: string

function policy(text: string): void {
  writeFileSync(join(tmpDir, '.dkm', 'policy.toml'), text)
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dkm-policy-'))
  mkdirSync(join(tmpDir, '.dkm'), { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

test('a policy with no [blast] table gets the defaults', () => {
  policy('version = 1\n')
  expect(loadPolicy(tmpDir).blast).toEqual(DEFAULT_BLAST)
})

test('the [blast] table sets each rule by name', () => {
  policy(`version = 1

[blast]
egress = "off"
money = "off"
outside-worktree = "ask"
`)
  const b = loadPolicy(tmpDir).blast
  expect(b.egress).toBe('off')
  expect(b.money).toBe('off')
  expect(b['outside-worktree']).toBe('ask')
  expect(b['data-loss']).toBe('ask')
  expect(b.surface).toBe('ask')
})

test('a misspelt trip or setting is ignored, never guessed', () => {
  // A typo that silently switched a rule off would be a grant nobody wrote.
  policy(`version = 1

[blast]
egres = "off"
egress = "of"
`)
  expect(loadPolicy(tmpDir).blast.egress).toBe('ask')
})

test('a [blast] table does not leak into a following allow rule', () => {
  policy(`version = 1

[blast]
egress = "off"

[[allow]]
tool = "Bash"
match = "git push"
`)
  const p = loadPolicy(tmpDir)
  expect(p.blast.egress).toBe('off')
  expect(p.allow).toEqual([{ tool: 'Bash', match: 'git push' }])
})

test('an allow rule before the [blast] table is not corrupted by it', () => {
  policy(`version = 1

[[allow]]
tool = "Read"

[blast]
surface = "off"
`)
  const p = loadPolicy(tmpDir)
  expect(p.allow).toEqual([{ tool: 'Read' }])
  expect(p.blast.surface).toBe('off')
})
