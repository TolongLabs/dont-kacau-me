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

const SOURCE_DIRS = ['src', 'lib', 'app']

/**
 * The grant a vibecoder means when they reach for --dangerously-skip-permissions, minus the one
 * thing that flag gives up for nothing: every decision is still logged with the rule that made it,
 * and nothing is written outside this worktree. That last line is deliberately the only rule left
 * on and deliberately one word from off, so the reader sees the choice rather than inheriting it.
 */
export function suggestPolicy(root: string): string {
  const present = SOURCE_DIRS.filter((d) => existsSync(join(root, d)))
  const globs = present.flatMap((d) => [`${d}/**/types.ts`, `${d}/**/schema.ts`])
  return `# Written by \`dkm init\`. This file is your grant: DKM executes the decisions recorded here on
# your behalf, and never invents one. Every decision is logged in .dkm/decisions.jsonl with the
# rule that made it.

version = 1

# Paths whose change is worth telling a dependent session about.
contractGlobs = ${JSON.stringify(globs)}

# Each rule that would otherwise stop the agent. "off" removes it. "ask" stops for you, and is
# auto-denied when you are not there. "deny" blocks it outright.
[blast]
outside-worktree = "deny"   # the one rule left on: nothing is written outside this worktree
data-loss = "off"           # rm -rf, destructive SQL, migrations
egress = "off"              # git push, deploys, curl, gh writes
money = "off"               # npm publish, vercel deploy, gh release
surface = "off"             # package.json, lockfiles, .env, .dkm/

# Everything else is yours to run.
[[allow]]
tool = "*"
`
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

  lines.push('', 'In this repository:')
  for (const line of summarise(root, target)) lines.push(`  ${line}`)

  lines.push(
    '',
    'Next:',
    `  1. Read ${target} and delete anything you did not mean to grant, then commit it.`,
    '  2. Keep working. Prompts you granted stop arriving in this session; nothing else to do.',
    '',
    'To run several agents on this repository at once:',
    '  Open more Claude Code tabs in this same directory. Each one is a peer: it gets its own copy',
    "  of every update DKM delivers, and it can message the others with Claude Code's own",
    '  session-to-session tools.',
    '',
    '  To publish receipts to a GitHub issue or PR, bind this directory once from any tab:',
    '',
    '    /dont-kacau-me:dkm-bind <issue-number>',
    '',
    '  Binding needs an authenticated gh and a GitHub remote; nothing above this line does.',
    '  A second checkout on another branch is a git worktree, and can be bound to its own item.'
  )
  return { output: `${lines.join('\n')}\n`, wrote }
}

function summarise(root: string, target: string): string[] {
  const text = existsSync(target) ? readFileSync(target, 'utf8') : suggestPolicy(root)
  const wildcard = /^\s*tool\s*=\s*"\*"/m.test(text)
  const setting = (trip: string): string => {
    const m = new RegExp(`^\\s*${trip}\\s*=\\s*"(deny|ask|off)"`, 'm').exec(text)
    return m?.[1] ?? (trip === 'outside-worktree' ? 'deny' : 'ask')
  }
  const trips: Record<string, string> = {
    'outside-worktree': 'writing outside this worktree',
    'data-loss': 'rm -rf, destructive SQL, migrations',
    egress: 'git push, deploys, curl, gh writes',
    money: 'npm publish, vercel deploy, gh release',
    surface: 'package.json, lockfiles, .env, .dkm/'
  }
  const out: string[] = []
  out.push(wildcard ? 'every tool, inside this worktree' : 'only the tools listed in the policy')
  const asks = Object.entries(trips)
    .filter(([t]) => setting(t) === 'ask')
    .map(([, d]) => d)
  const denies = Object.entries(trips)
    .filter(([t]) => setting(t) === 'deny')
    .map(([, d]) => d)
  if (asks.length > 0) out.push(`still asks you (auto-denied when AFK): ${asks.join('; ')}`)
  if (denies.length > 0) out.push(`blocked: ${denies.join('; ')}`)
  if (asks.length === 0 && denies.length === 0) out.push('nothing is held back')
  return out
}
