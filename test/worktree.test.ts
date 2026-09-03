import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
