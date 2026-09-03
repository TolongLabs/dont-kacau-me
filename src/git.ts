import { spawnSync } from 'node:child_process'
import type { ChangedPath } from './types'

type DiffStatus = 'A' | 'M' | 'D' | 'R' | 'C'

const statusByLetter: Record<string, DiffStatus> = {
  A: 'A',
  M: 'M',
  D: 'D',
  R: 'R',
  C: 'C'
}

function git(worktreePath: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: worktreePath, encoding: 'utf8' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim())
  }
  return result.stdout
}

export function resolveHead(worktreePath: string): string {
  return git(worktreePath, ['rev-parse', 'HEAD']).trim()
}

export function resolveBase(worktreePath: string, baseRef: string): string {
  return git(worktreePath, ['merge-base', 'HEAD', baseRef]).trim()
}

export function changedPaths(worktreePath: string, base: string, head: string): ChangedPath[] {
  const output = git(worktreePath, ['diff', '--name-status', `${base}..${head}`]).trim()
  if (output === '') {
    return []
  }
  const paths: ChangedPath[] = []
  for (const line of output.split('\n')) {
    const [raw, a, b] = line.split('\t')
    if (raw === undefined) {
      continue
    }
    const letter = raw[0]
    if (letter === undefined) {
      continue
    }
    const status = statusByLetter[letter]
    if (status === undefined) {
      continue
    }
    if (status === 'R' || status === 'C') {
      if (b !== undefined) {
        paths.push({ status, path: b })
      }
    } else if (a !== undefined) {
      paths.push({ status, path: a })
    }
  }
  return paths
}

function segmentMatch(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) {
    return pattern === value
  }
  const parts = pattern.split('*')
  const first = parts[0] ?? ''
  const last = parts.at(-1) ?? ''
  if (first !== '' && !value.startsWith(first)) {
    return false
  }
  if (last !== '' && !value.endsWith(last)) {
    return false
  }
  let pos = first.length
  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i] ?? ''
    if (part === '') {
      continue
    }
    const idx = value.indexOf(part, pos)
    if (idx === -1) {
      return false
    }
    pos = idx + part.length
  }
  return true
}

function matchSegments(pattern: string[], value: string[], patternIndex: number, valueIndex: number): boolean {
  if (patternIndex === pattern.length) {
    return valueIndex === value.length
  }
  const pat = pattern[patternIndex] ?? ''
  if (pat === '**') {
    if (patternIndex === pattern.length - 1) {
      return true
    }
    for (let i = valueIndex; i <= value.length; i++) {
      if (matchSegments(pattern, value, patternIndex + 1, i)) {
        return true
      }
    }
    return false
  }
  if (valueIndex === value.length) {
    return false
  }
  if (segmentMatch(pat, value[valueIndex] ?? '')) {
    return matchSegments(pattern, value, patternIndex + 1, valueIndex + 1)
  }
  return false
}

function globMatch(pattern: string, value: string): boolean {
  return matchSegments(pattern.split('/'), value.split('/'), 0, 0)
}

export function contractDelta(changed: ChangedPath[], globs: string[]): string[] {
  const matched = new Set<string>()
  for (const { path } of changed) {
    if (globs.some((glob) => globMatch(glob, path))) {
      matched.add(path)
    }
  }
  return [...matched].sort()
}

export function isDetachedHead(worktreePath: string): boolean {
  try {
    git(worktreePath, ['symbolic-ref', '-q', 'HEAD'])
    return false
  } catch {
    return true
  }
}
