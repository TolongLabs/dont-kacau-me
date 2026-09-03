import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { changedPaths, contractDelta, isDetachedHead, resolveBase, resolveHead } from './git'

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dkm-git-'))
  git(['init'], dir)
  git(['config', 'user.name', 'Test'], dir)
  git(['config', 'user.email', 'test@example.com'], dir)
  return dir
}

function commit(cwd: string, message: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(cwd, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  git(['add', '.'], cwd)
  git(['commit', '-m', message], cwd)
}

function setupChangedFixture(repo: string): void {
  commit(repo, 'base', {
    'a.txt': 'a',
    'b.txt': 'b',
    'c.txt': 'c',
    'package.json': '{}',
    'src/main.ts': 'console.log()'
  })
  git(['branch', 'base'], repo)

  fs.writeFileSync(path.join(repo, 'a.txt'), 'aa')
  fs.writeFileSync(path.join(repo, 'd.txt'), 'd')
  fs.mkdirSync(path.join(repo, 'src/lib'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'src/lib/helper.ts'), 'export const x = 1')
  fs.writeFileSync(path.join(repo, 'src/main.ts'), 'console.warn()')
  git(['rm', 'b.txt'], repo)
  git(['mv', 'c.txt', 'z.txt'], repo)
  git(['add', '.'], repo)
  git(['commit', '-m', 'head'], repo)
}

test('resolveHead returns the HEAD SHA and isDetachedHead is false on a branch', () => {
  const repo = initRepo()
  try {
    commit(repo, 'init', { 'a.txt': 'a' })
    const head = resolveHead(repo)
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    expect(isDetachedHead(repo)).toBe(false)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('isDetachedHead is true when HEAD is detached', () => {
  const repo = initRepo()
  try {
    commit(repo, 'init', { 'a.txt': 'a' })
    const sha = resolveHead(repo)
    git(['checkout', sha], repo)
    expect(isDetachedHead(repo)).toBe(true)
    expect(resolveHead(repo)).toBe(sha)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('resolveBase returns the merge base with the given ref', () => {
  const repo = initRepo()
  try {
    commit(repo, 'base', { 'a.txt': 'a' })
    git(['branch', 'base'], repo)
    commit(repo, 'head', { 'b.txt': 'b' })
    const base = resolveBase(repo, 'base')
    const baseSha = git(['rev-parse', 'base'], repo).trim()
    expect(base).toBe(baseSha)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('changedPaths reports added, modified, deleted and renamed paths', () => {
  const repo = initRepo()
  try {
    setupChangedFixture(repo)
    const paths = changedPaths(repo, resolveBase(repo, 'base'), resolveHead(repo))

    expect(paths).toContainEqual({ status: 'A', path: 'd.txt' })
    expect(paths).toContainEqual({ status: 'M', path: 'a.txt' })
    expect(paths).toContainEqual({ status: 'D', path: 'b.txt' })
    expect(paths).toContainEqual({ status: 'R', path: 'z.txt' })
    expect(paths).toContainEqual({ status: 'A', path: 'src/lib/helper.ts' })
    expect(paths).toContainEqual({ status: 'M', path: 'src/main.ts' })
    expect(paths).toHaveLength(6)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('changedPaths returns an empty array when there is no diff', () => {
  const repo = initRepo()
  try {
    commit(repo, 'init', { 'a.txt': 'a' })
    const head = resolveHead(repo)
    expect(changedPaths(repo, head, head)).toEqual([])
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('contractDelta matches star, double-star, literal and no-match globs, sorted and deduped', () => {
  const repo = initRepo()
  try {
    setupChangedFixture(repo)
    const changed = changedPaths(repo, resolveBase(repo, 'base'), resolveHead(repo))

    expect(contractDelta(changed, ['*.txt'])).toEqual(['a.txt', 'b.txt', 'd.txt', 'z.txt'])
    expect(contractDelta(changed, ['src/**/*.ts'])).toEqual(['src/lib/helper.ts', 'src/main.ts'])
    expect(contractDelta(changed, ['a.txt'])).toEqual(['a.txt'])
    expect(contractDelta(changed, ['*.md'])).toEqual([])
    expect(contractDelta(changed, ['*.txt', 'src/**/*.ts', 'a.txt'])).toEqual([
      'a.txt',
      'b.txt',
      'd.txt',
      'src/lib/helper.ts',
      'src/main.ts',
      'z.txt'
    ])
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})
