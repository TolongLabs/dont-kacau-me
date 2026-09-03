import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Policy, PolicyAllowRule } from './types'

const DEFAULT_POLICY: Policy = { version: 1, allow: [], contractGlobs: [] }

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
    const text = readFileSync(join(root, '.dkm', 'policy.toml'), 'utf8')
    const policy: Policy = { version: 1, allow: [], contractGlobs: [] }
    let currentRule: PolicyAllowRule | null = null
    for (const rawLine of text.split('\n')) {
      const line = stripInlineComment(rawLine).trim()
      if (line === '') continue
      if (line.startsWith('[[') && line.endsWith(']]')) {
        const table = line.slice(2, -2).trim()
        if (table === 'allow') {
          currentRule = { tool: '' }
          policy.allow.push(currentRule)
        }
        continue
      }
      if (line.startsWith('[')) {
        currentRule = null
        continue
      }
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim()
      if (currentRule === null) {
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
    return DEFAULT_POLICY
  }
}
