import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPolicy } from '../src/policy'
import { readBindings, writeBindings } from '../src/store'
import type { WorkItemRef } from '../src/types'

function git(args: string[], cwd: string): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

function makeRepoWithWorktree(): { main: string; linked: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'dkm-wt-'))
  const main = join(base, 'repo')
  const linked = join(base, 'wt')
  git(['init', '-q', '-b', 'main', main], base)
  git(['config', 'user.email', 't@t'], main)
  git(['config', 'user.name', 't'], main)
  spawnSync('bash', ['-c', 'echo one > a.txt'], { cwd: main })
  git(['add', '-A'], main)
  git(['commit', '-qm', 'one'], main)
  git(['worktree', 'add', '-q', linked, '-b', 'feature'], main)
  return { main, linked, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

const item: WorkItemRef = { repoNodeId: 'R_1', itemNodeId: 'I_1', number: 1, kind: 'issue' }

/**
 * The product exists so worktree B can see what worktree A is doing. If state resolved from each
 * caller's own toplevel, every worktree would get a private .dkm/ and that would be impossible.
 */
test('a linked worktree reads state written by the main worktree', () => {
  const { main, linked, cleanup } = makeRepoWithWorktree()
  try {
    writeBindings(main, {
      version: 1,
      bindings: [{ worktreePath: main, bound: item, followed: [], ambient: true }]
    })
    const seenFromLinked = readBindings(linked)
    expect(seenFromLinked.bindings).toHaveLength(1)
    expect(seenFromLinked.bindings[0]?.bound).toEqual(item)
  } finally {
    cleanup()
  }
})

test('a write from the linked worktree is visible in the main worktree', () => {
  const { main, linked, cleanup } = makeRepoWithWorktree()
  try {
    writeBindings(linked, {
      version: 1,
      bindings: [{ worktreePath: linked, bound: item, followed: [], ambient: false }]
    })
    expect(readBindings(main).bindings[0]?.worktreePath).toBe(linked)
  } finally {
    cleanup()
  }
})

test('state is stored once, at the main worktree root', () => {
  const { main, linked, cleanup } = makeRepoWithWorktree()
  try {
    writeBindings(linked, { version: 1, bindings: [] })
    expect(existsSync(join(main, '.dkm', 'bindings.json'))).toBe(true)
    expect(existsSync(join(linked, '.dkm', 'bindings.json'))).toBe(false)
  } finally {
    cleanup()
  }
})

/**
 * The policy is the human's grant. Reading it from the caller's own checkout let a branch carry its
 * own rules, which means a session that can commit could widen the authority governing it on its
 * next turn. One repository, one grant.
 */
test('a linked worktree is governed by the repository policy, not its own checkout', () => {
  const { main, linked, cleanup } = makeRepoWithWorktree()
  try {
    mkdirSync(join(main, '.dkm'), { recursive: true })
    writeFileSync(join(main, '.dkm', 'policy.toml'), '[[allow]]\ntool = "Read"\n')
    // A policy planted in the linked worktree must not win.
    mkdirSync(join(linked, '.dkm'), { recursive: true })
    writeFileSync(join(linked, '.dkm', 'policy.toml'), '[[allow]]\ntool = "Bash"\n[[allow]]\ntool = "Write"\n')

    const policy = loadPolicy(linked)
    expect(policy.allow).toHaveLength(1)
    expect(policy.allow[0]?.tool).toBe('Read')
  } finally {
    cleanup()
  }
})
