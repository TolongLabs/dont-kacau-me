import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dkmPath } from './store'
import type { BlastRadiusTrip, BlastSetting, Policy, PolicyAllowRule } from './types'

/**
 * What each blast-radius rule does when the policy says nothing. `outside-worktree` denies and the
 * rest ask, which is the behaviour before the `[blast]` table existed. The table can set any of them,
 * including `outside-worktree`, to `off`; that is a grant the installer writes and commits, which is
 * the only kind of grant DKM executes.
 */
export const DEFAULT_BLAST: Record<BlastRadiusTrip, BlastSetting> = {
  'outside-worktree': 'deny',
  'data-loss': 'ask',
  egress: 'ask',
  money: 'ask',
  surface: 'ask'
}

const BLAST_TRIPS = new Set<string>(Object.keys(DEFAULT_BLAST))
const BLAST_SETTINGS = new Set<string>(['deny', 'ask', 'off'])

function emptyPolicy(): Policy {
  return { version: 1, allow: [], contractGlobs: [], blast: { ...DEFAULT_BLAST } }
}

function stripInlineComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i)
    if (c === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (c === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (c === '#' && !inSingle && !inDouble) {
      return line.slice(0, i)
    }
  }
  return line
}

function parseString(raw: string): string {
  const text = raw.trim()
  if (text.length >= 2 && text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') {
    return text.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  }
  if (text.length >= 2 && text.charAt(0) === "'" && text.charAt(text.length - 1) === "'") {
    return text.slice(1, -1)
  }
  return text
}

function parseStringArray(raw: string): string[] {
  const text = raw.trim()
  if (!text.startsWith('[') || !text.endsWith(']')) return []
  const inner = text.slice(1, -1).trim()
  if (inner === '') return []
  const parts: string[] = []
  let start = 0
  let depth = 0
  let inSingle = false
  let inDouble = false
  for (let i = 0; i <= inner.length; i++) {
    const c = inner.charAt(i)
    if (c === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (c === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (!inSingle && !inDouble) {
      if (c === '[') depth++
      if (c === ']') depth--
      if (c === ',' && depth === 0) {
        parts.push(parseString(inner.slice(start, i)))
        start = i + 1
      }
    }
    if (i === inner.length) {
      parts.push(parseString(inner.slice(start)))
    }
  }
  return parts.filter((p) => p !== '')
}

export function loadPolicy(root: string): Policy {
  try {
    // Through dkmPath, not join(root, '.dkm'): in a linked worktree `--show-toplevel` is that
    // worktree, so reading from it would govern each branch by its own checked-out policy. One
    // repository has one grant, and a session must not be able to widen its own by switching branch.
    const text = readFileSync(join(dkmPath(root), 'policy.toml'), 'utf8')
    const policy = emptyPolicy()
    let currentRule: PolicyAllowRule | null = null
    let inBlast = false
    for (const rawLine of text.split('\n')) {
      const line = stripInlineComment(rawLine).trim()
      if (line === '') continue
      if (line.startsWith('[[') && line.endsWith(']]')) {
        const table = line.slice(2, -2).trim()
        inBlast = false
        if (table === 'allow') {
          currentRule = { tool: '' }
          policy.allow.push(currentRule)
        }
        continue
      }
      if (line.startsWith('[')) {
        currentRule = null
        inBlast = line.slice(1, -1).trim() === 'blast'
        continue
      }
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim()
      if (inBlast) {
        const setting = parseString(value)
        // An unknown trip or setting is ignored rather than guessed at. A typo that silently
        // switched a rule off would be a grant nobody wrote.
        if (BLAST_TRIPS.has(key) && BLAST_SETTINGS.has(setting)) {
          policy.blast[key as BlastRadiusTrip] = setting as BlastSetting
        }
      } else if (currentRule === null) {
        if (key === 'contractGlobs') {
          policy.contractGlobs = parseStringArray(value)
        }
      } else {
        if (key === 'tool') currentRule.tool = parseString(value)
        else if (key === 'match') currentRule.match = parseString(value)
        else if (key === 'paths') currentRule.paths = parseStringArray(value)
      }
    }
    return policy
  } catch {
    return emptyPolicy()
  }
}
