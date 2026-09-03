import path from 'node:path'
import type { BlastRadiusTrip, DecisionInput, PermissionDecision, Policy, PolicyAllowRule } from './types'

const TRIPS: BlastRadiusTrip[] = ['outside-worktree', 'data-loss', 'money', 'egress', 'surface']

const SURFACE_FILES = new Set(['bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'package.json', '.env'])

function extractStrings(value: unknown): string[] {
  const out: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      out.push(v)
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item)
    } else if (v !== null && typeof v === 'object') {
      for (const item of Object.values(v as Record<string, unknown>)) walk(item)
    }
  }
  walk(value)
  return out
}

function getContentString(toolInput: unknown): string {
  if (typeof toolInput === 'string') return toolInput
  if (typeof toolInput === 'object' && toolInput !== null) {
    const t = toolInput as Record<string, unknown>
    for (const key of ['command', 'file_path', 'path', 'url']) {
      const v = t[key]
      if (typeof v === 'string') return v
    }
  }
  return ''
}

function stripQuotes(token: string): string {
  if (token.length >= 2 && token.charAt(0) === '"' && token.charAt(token.length - 1) === '"') {
    return token.slice(1, -1)
  }
  if (token.length >= 2 && token.charAt(0) === "'" && token.charAt(token.length - 1) === "'") {
    return token.slice(1, -1)
  }
  return token
}

function collectPathCandidates(toolInput: unknown): string[] {
  const seen = new Set<string>()
  const add = (s: string): void => {
    const v = s.trim()
    if (v === '') return
    seen.add(v)
  }
  for (const str of extractStrings(toolInput)) {
    add(str)
    for (const token of str.split(/\s+/)) {
      add(stripQuotes(token))
    }
  }
  return [...seen]
}

function isUnder(resolved: string, worktree: string): boolean {
  const w = path.resolve(worktree)
  if (resolved === w) return true
  const prefix = w === path.sep ? w : w + path.sep
  return resolved.startsWith(prefix)
}

function isOutsideWorktree(input: DecisionInput): boolean {
  for (const candidate of collectPathCandidates(input.toolInput)) {
    const resolved = path.resolve(input.cwd, candidate)
    if (!isUnder(resolved, input.worktreePath)) return true
  }
  return false
}

function isRmRf(str: string): boolean {
  const [first, ...rest] = str.split(/\s+/)
  if (first === undefined || !/^(?:\/?.*\/)?rm$/.test(first)) return false
  let hasR = false
  let hasF = false
  for (const t of rest) {
    const lower = t.toLowerCase()
    if (lower === '--') break
    if (lower === '-r' || lower === '--recursive') hasR = true
    if (lower === '-f' || lower === '--force') hasF = true
    if (lower.startsWith('-') && !lower.startsWith('--') && lower.length > 1) {
      if (lower.includes('r') && lower.includes('f')) return true
    }
  }
  return hasR && hasF
}

function hasDestructiveSql(str: string): boolean {
  const lower = str.toLowerCase()
  return (
    lower.includes('drop table') ||
    lower.includes('drop column') ||
    lower.includes('truncate') ||
    lower.includes('delete from')
  )
}

function isDataLoss(input: DecisionInput): boolean {
  for (const str of extractStrings(input.toolInput)) {
    if (isRmRf(str) || hasDestructiveSql(str)) return true
  }
  for (const candidate of collectPathCandidates(input.toolInput)) {
    const resolved = path.resolve(input.cwd, candidate)
    for (const part of resolved.split(path.sep)) {
      const lower = part.toLowerCase()
      if (lower === 'migrations' || lower === 'drizzle') return true
    }
  }
  return false
}

function isMoney(input: DecisionInput): boolean {
  for (const str of extractStrings(input.toolInput)) {
    const lower = str.toLowerCase()
    if (/\bnpm\s+publish\b/.test(lower)) return true
    if (/\bbun\s+publish\b/.test(lower)) return true
    if (/\bvercel\s+deploy\b/.test(lower)) return true
    if (/\bgh\s+release\s+create\b/.test(lower)) return true
  }
  return false
}

function isEgress(input: DecisionInput): boolean {
  for (const str of extractStrings(input.toolInput)) {
    if (/\b(curl|wget)\b/i.test(str)) return true
    if (/\bgit\s+push\b/i.test(str)) return true
    if (/\b(bun|npm)\s+run\s+deploy\b/i.test(str)) return true
    if (/\bdeploy\b/i.test(str) && !/\bvercel\s+deploy\b/i.test(str)) return true
    if (/\bgh\s+(pr\s+create|issue\s+create|pr\s+comment|issue\s+comment)\b/i.test(str)) {
      return true
    }
    if (/\bgh\s+api\s+.*?\s-X\s+(POST|PATCH|PUT|DELETE)\b/i.test(str)) return true
  }
  return false
}

/**
 * `.dkm/` is on this list because the policy is the human grant. An agent that can edit the file
 * granting its own authority can widen that authority without anyone deciding to, which is the one
 * thing the authority principle forbids. Reaching the human is the whole point, so this is `ask`.
 */
function isSurface(input: DecisionInput): boolean {
  for (const candidate of collectPathCandidates(input.toolInput)) {
    const resolved = path.resolve(input.cwd, candidate)
    const base = path.basename(resolved)
    if (SURFACE_FILES.has(base)) return true
    if (base.startsWith('.env.')) return true
    if (resolved.split(path.sep).includes('.dkm')) return true
  }
  return false
}

function globToRegex(pattern: string): RegExp {
  let p = pattern.replace(/\*\*/g, '\0')
  p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  p = p.replace(/\*/g, '[^/]*')
  p = p.replace(/\?/g, '.')
  p = p.replace(/\0/g, '.*')
  return new RegExp(`^${p}$`)
}

function globMatch(value: string, pattern: string): boolean {
  return globToRegex(pattern).test(value)
}

function collectRelativePaths(input: DecisionInput): string[] {
  const out: string[] = []
  for (const candidate of collectPathCandidates(input.toolInput)) {
    const resolved = path.resolve(input.cwd, candidate)
    if (isUnder(resolved, input.worktreePath)) {
      const rel = path.relative(input.worktreePath, resolved)
      if (rel !== '') out.push(rel)
    }
  }
  return out
}

function ruleMatches(input: DecisionInput, rule: PolicyAllowRule): boolean {
  if (rule.tool !== input.toolName) return false
  if (rule.match !== undefined) {
    if (!getContentString(input.toolInput).includes(rule.match)) return false
  }
  const rulePaths = rule.paths
  if (rulePaths !== undefined && rulePaths.length > 0) {
    const relativePaths = collectRelativePaths(input)
    if (relativePaths.length === 0) return false
    const hasMatch = relativePaths.some((p) => rulePaths.some((pattern) => globMatch(p, pattern)))
    if (!hasMatch) return false
  }
  return true
}

export function decide(
  input: DecisionInput,
  policy: Policy
): { decision: PermissionDecision; rule: string; trip: BlastRadiusTrip | null } {
  for (const trip of TRIPS) {
    let matched = false
    if (trip === 'outside-worktree') matched = isOutsideWorktree(input)
    else if (trip === 'data-loss') matched = isDataLoss(input)
    else if (trip === 'money') matched = isMoney(input)
    else if (trip === 'egress') matched = isEgress(input)
    else if (trip === 'surface') matched = isSurface(input)
    if (matched) {
      return { decision: trip === 'outside-worktree' ? 'deny' : 'ask', rule: `blast:${trip}`, trip }
    }
  }
  for (const [i, rule] of policy.allow.entries()) {
    if (ruleMatches(input, rule)) {
      return { decision: 'allow', rule: `policy.allow[${i}]`, trip: null }
    }
  }
  return { decision: 'ask', rule: 'default', trip: null }
}
