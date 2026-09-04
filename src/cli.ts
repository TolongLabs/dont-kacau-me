import { workItemByNumber } from './github'
import { readReport, writeReport } from './hooks/report'
import { repoRoot } from './hooks/runtime'
import { runInit } from './init'
import { runSupervised } from './revive-run'
import { listPending, readBindings, readDecisions, recipientKey, writeBindings } from './store'
import type { Binding, WorkItemRef } from './types'

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

/**
 * Claude Code exports CLAUDE_CODE_SESSION_ID. Keying the report on anything else writes a file the
 * Stop hook never looks for, which silently drops every narrative and blocker a session records.
 */
function sessionId(): string {
  return process.env.CLAUDE_CODE_SESSION_ID ?? 'cli'
}

function bindingFor(root: string): Binding {
  const file = readBindings(root)
  const existing = file.bindings.find((b) => b.worktreePath === root)
  if (existing !== undefined) return existing
  const created: Binding = { worktreePath: root, bound: null, followed: [], ambient: true }
  file.bindings.push(created)
  writeBindings(root, file)
  return created
}

function save(root: string, updated: Binding): void {
  const file = readBindings(root)
  file.bindings = file.bindings.filter((b) => b.worktreePath !== updated.worktreePath)
  file.bindings.push(updated)
  writeBindings(root, file)
}

function resolve(root: string, raw: string | undefined): WorkItemRef {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) fail('expected a work item number, e.g. 81')
  const item = workItemByNumber(root, n)
  if (item === null) fail(`could not resolve #${n}; is gh authenticated and the item visible?`)
  return item
}

function describe(item: WorkItemRef): string {
  return `${item.kind === 'pr' ? 'PR' : 'issue'} #${item.number}`
}

function status(root: string): string {
  const binding = bindingFor(root)
  const pending = listPending(root, recipientKey(root))
  const decisions = readDecisions(root)
  const recent = decisions.slice(-5)
  const lines = [
    `bound     ${binding.bound === null ? '(none)' : describe(binding.bound)}`,
    `followed  ${binding.followed.length === 0 ? '(none)' : binding.followed.map(describe).join(', ')}`,
    `ambient   ${binding.ambient ? 'on' : 'off'}`,
    `pending   ${pending.length} undelivered`,
    `decisions ${decisions.length} recorded`
  ]
  if (recent.length > 0) {
    lines.push('', 'most recent decisions:')
    for (const d of recent) lines.push(`  ${d.decision.padEnd(5)} ${d.rule.padEnd(24)} ${d.summary}`)
  }
  return lines.join('\n')
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2)
  const root = repoRoot(process.cwd())
  if (root === null && command === 'init') {
    // The first thing a new user runs, so it must name the fix rather than the symptom.
    fail(
      'not a git repository yet. DKM keys its state to a worktree path, so run `git init` here (or cd into your\nrepository) and run this again.'
    )
  }
  if (root === null) fail('not inside a git worktree')

  if (command === 'bind') {
    const item = resolve(root, rest[0])
    save(root, { ...bindingFor(root), bound: item })
    process.stdout.write(`bound this worktree to ${describe(item)}\n`)
    return
  }

  if (command === 'follow') {
    const item = resolve(root, rest[0])
    const binding = bindingFor(root)
    if (binding.followed.some((f) => f.itemNodeId === item.itemNodeId)) {
      process.stdout.write(`already following ${describe(item)}\n`)
      return
    }
    save(root, { ...binding, followed: [...binding.followed, item] })
    process.stdout.write(`following ${describe(item)}\n`)
    return
  }

  if (command === 'unfollow') {
    const item = resolve(root, rest[0])
    const binding = bindingFor(root)
    save(root, { ...binding, followed: binding.followed.filter((f) => f.itemNodeId !== item.itemNodeId) })
    process.stdout.write(`stopped following ${describe(item)}\n`)
    return
  }

  if (command === 'note') {
    const text = rest.join(' ').trim()
    if (text.length === 0) fail('expected some text to record')
    const session = sessionId()
    const current = readReport(root, session)
    writeReport(root, session, { ...current, narrative: text })
    process.stdout.write('narrative recorded; it will appear on the next receipt\n')
    return
  }

  if (command === 'blocker') {
    const text = rest.join(' ').trim()
    if (text.length === 0) fail('expected the blocker text')
    const session = sessionId()
    const current = readReport(root, session)
    writeReport(root, session, { ...current, blockers: [...current.blockers, text] })
    process.stdout.write('blocker recorded; it will appear on the next receipt\n')
    return
  }

  if (command === 'revive') {
    const sep = rest.indexOf('--')
    const prompt = (sep === -1 ? rest : rest.slice(0, sep)).join(' ').trim()
    const claudeArgs = sep === -1 ? [] : rest.slice(sep + 1)
    if (prompt.length === 0) fail('expected the prompt to run, e.g. dkm revive "work through issue 12"')
    const report = runSupervised({ root, prompt, claudeArgs, maxAttempts: 24 })
    if (report.outcome.kind === 'done') {
      process.stdout.write(`${report.outcome.result}\n`)
      return
    }
    fail(`run did not finish after ${report.attempts} attempt(s): ${report.outcome.kind}`)
  }

  if (command === 'init') {
    const result = runInit(root, rest.includes('--force'))
    process.stdout.write(result.output)
    return
  }

  if (command === 'status' || command === undefined) {
    process.stdout.write(`${status(root)}\n`)
    return
  }

  fail(`unknown command: ${command}\nexpected one of: init, bind, follow, unfollow, note, blocker, revive, status`)
}

main()
