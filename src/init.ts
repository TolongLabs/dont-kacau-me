import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dkmPath } from './store'

export type Check = { name: string; ok: boolean; detail: string }

function run(command: string, args: string[], cwd: string): { ok: boolean; out: string } {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 5000 })
  return { ok: r.status === 0 && r.error === undefined, out: (r.stdout ?? '').trim() }
}

/**
 * Separate from `preflight` so it can be exercised without the `gh` calls, which reach the network
 * and cost seconds apiece.
 */
export function gitCheck(root: string): Check {
  const git = run('git', ['rev-parse', '--show-toplevel'], root)
  return { name: 'git repository', ok: git.ok, detail: git.ok ? git.out : 'run: git init' }
}

/**
 * Every failing check carries the command that fixes it. A preflight that only reports a missing
 * dependency leaves the reader to search for the fix, which is the moment most people give up.
 */
export function preflight(root: string): Check[] {
  const checks: Check[] = []

  checks.push(gitCheck(root))

  const bun = run('bun', ['--version'], root)
  checks.push({ name: 'bun', ok: bun.ok, detail: bun.ok ? bun.out : 'install it from https://bun.sh' })

  const gh = run('gh', ['--version'], root)
  const ghLine = gh.out.split('\n')[0] ?? ''
  checks.push({ name: 'gh installed', ok: gh.ok, detail: gh.ok ? ghLine : 'install it from https://cli.github.com' })

  const auth = gh.ok ? run('gh', ['auth', 'status'], root) : { ok: false, out: '' }
  checks.push({ name: 'gh authenticated', ok: auth.ok, detail: auth.ok ? 'ok' : 'run: gh auth login' })

  const remote = gh.ok ? run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], root) : null
  const hasRemote = remote?.ok === true && remote.out.length > 0
  checks.push({
    name: 'GitHub remote',
    ok: hasRemote,
    detail: hasRemote ? remote.out : 'receipts need one; the policy half works without it'
  })

  return checks
}

function scripts(root: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return new Set()
    const s = (parsed as Record<string, unknown>).scripts
    if (typeof s !== 'object' || s === null) return new Set()
    return new Set(Object.keys(s as Record<string, unknown>))
  } catch {
    return new Set()
  }
}

function packageManager(root: string): string {
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun'
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

const SOURCE_DIRS = ['src', 'lib', 'app', 'docs', 'test', 'tests']

/**
 * Generated from what the repository actually contains, because the step people abandon is writing
 * TOML for a schema they have just met. A grant for a directory that does not exist teaches nothing.
 */
export function suggestPolicy(root: string): string {
  const present = SOURCE_DIRS.filter((d) => existsSync(join(root, d)))
  const writable = present.length > 0 ? present : ['src']
  const pm = packageManager(root)
  const available = scripts(root)
  const commands: string[] = []
  if (available.has('test')) commands.push(`${pm} test`)
  for (const name of ['lint', 'typecheck', 'build', 'format']) {
    if (available.has(name)) commands.push(`${pm} run ${name}`)
  }

  const lines = [
    '# Written by `dkm init`. This file is your grant: DKM may execute the decisions recorded',
    '# here on your behalf, and may never invent one. Anything not listed falls through to `ask`,',
    '# which is exactly the behaviour you have today.',
    '#',
    '# Blast-radius rules always run first and cannot be overridden from here. Deleting data,',
    '# spending money, pushing, deploying, and writes to a lockfile, package.json, .env or .dkm/',
    '# reach you no matter what you allow below.',
    '',
    'version = 1',
    '',
    '# Paths whose change is worth telling a dependent session about.',
    `contractGlobs = ${JSON.stringify(present.includes('src') ? ['src/**/types.ts', 'src/**/schema.ts'] : [])}`,
    '',
    '# Looking at code changes nothing.',
    '[[allow]]',
    'tool = "Read"',
    '',
    '[[allow]]',
    'tool = "Grep"',
    '',
    '[[allow]]',
    'tool = "Glob"'
  ]

  for (const command of commands) {
    lines.push('', '[[allow]]', 'tool = "Bash"', `match = "${command}"`)
  }

  const globs = writable.map((d) => `${d}/**`)
  for (const tool of ['Write', 'Edit']) {
    lines.push('', '[[allow]]', `tool = "${tool}"`, `paths = ${JSON.stringify(globs)}`)
  }

  return `${lines.join('\n')}\n`
}

export type InitResult = { output: string; wrote: boolean }

/**
 * `checks` is injectable because preflight shells out to `gh`, which reaches the network. A test
 * that ran the real thing spent five seconds per case waiting for a lookup whose answer it had
 * already decided.
 */
export function runInit(root: string, force: boolean, checks: Check[] = preflight(root)): InitResult {
  const dir = dkmPath(root)
  const target = join(dir, 'policy.toml')
  const existed = existsSync(target)
  const wrote = !existed || force

  if (wrote) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(target, suggestPolicy(root))
  }

  const lines = ['Checks']
  for (const c of checks) lines.push(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(18)} ${c.detail}`)
  lines.push(
    `  ${'✓'} ${'policy'.padEnd(18)} ${wrote ? `written to ${target}` : `already at ${target}; --force to replace`}`
  )

  lines.push('', 'Now automatic in this repository:')
  for (const line of summarise(root, target)) lines.push(`  ${line}`)

  lines.push(
    '',
    'Still asks you, whatever the policy says:',
    '  deleting data, spending money, pushing, deploying,',
    '  and writes to a lockfile, package.json, .env or .dkm/',
    '',
    'Next:',
    `  1. Read ${target} and delete anything you did not mean to grant, then commit it.`,
    '  2. Keep working. Prompts you granted stop arriving in this session; nothing else to do.',
    '',
    'When you want a second piece of work running at the same time:',
    '  Give it its own worktree, not a second session in this directory. A worktree is a second',
    '  checkout you can work in simultaneously, and DKM keys everything to its path:',
    '',
    '    git worktree add ../<name> -b <branch>',
    '',
    '  Open Claude Code there, then bind each one to the item it owns:',
    '',
    '    /dont-kacau-me:dkm-bind <issue-number>',
    '',
    '  Receipts then publish to those items, and /dont-kacau-me:dkm-follow <n> in one worktree',
    "  brings the other one's contract changes into it. Binding needs an authenticated gh and a",
    '  GitHub remote; everything above this line does not.',
    '',
    '  Two sessions in one directory share a single queue and will race for the same events, so',
    '  give each its own worktree.'
  )
  return { output: `${lines.join('\n')}\n`, wrote }
}

function summarise(root: string, target: string): string[] {
  const text = existsSync(target) ? readFileSync(target, 'utf8') : suggestPolicy(root)
  const tools: string[] = []
  const commands: string[] = []
  const paths: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const tool = /^tool\s*=\s*"([^"]+)"/.exec(line)
    if (tool?.[1] !== undefined) tools.push(tool[1])
    const match = /^match\s*=\s*"([^"]+)"/.exec(line)
    if (match?.[1] !== undefined) commands.push(match[1])
    const p = /^paths\s*=\s*\[(.*)\]/.exec(line)
    if (p?.[1] !== undefined) {
      for (const piece of p[1].split(',')) {
        const cleaned = piece.trim().replace(/^"|"$/g, '')
        if (cleaned !== '') paths.push(cleaned)
      }
    }
  }
  const readOnly = ['Read', 'Grep', 'Glob'].filter((t) => tools.includes(t))
  const out: string[] = []
  if (readOnly.length > 0) out.push(`${readOnly.join(', ')} — looking at code`)
  if (commands.length > 0) out.push(`${[...new Set(commands)].join(', ')}`)
  if (paths.length > 0) out.push(`writing under ${[...new Set(paths)].join(', ')}`)
  if (out.length === 0) out.push('nothing yet; the policy grants no tools')
  return out
}
