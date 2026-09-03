import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderReceipt } from '../src/receipt'
import type { PendingEvent, Receipt } from '../src/types'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const hooksDir = join(projectRoot, 'src', 'hooks')
const fakeGhPath = join(projectRoot, 'test', 'fake-gh.ts')

type Fixture = Record<string, Array<{ stdout: string; status?: number; stderr?: string }>>

const emptyChecks = JSON.stringify({ check_runs: [] })
const emptyComments = '[]'
const newComment = JSON.stringify({ id: 12345 })
const existingComment = JSON.stringify([{ id: 12345, body: '<!-- dkm:receipt v1 -->\n\n<!-- /dkm:receipt -->' }])

function exec(cwd: string, cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 10000 })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr ?? ''}`)
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'dkm-e2e-'))
  const origin = join(root, 'origin.git')
  exec(root, 'git', ['init', '--bare', '-q', origin])
  exec(root, 'git', ['init', '-q', '-b', 'main', '.'])
  exec(root, 'git', ['config', 'user.email', 't@t.com'])
  exec(root, 'git', ['config', 'user.name', 'Test'])
  exec(root, 'git', ['remote', 'add', 'origin', origin])
  writeFileSync(join(root, 'a.txt'), 'a')
  exec(root, 'git', ['add', '.'])
  exec(root, 'git', ['commit', '-m', 'init'])
  exec(root, 'git', ['checkout', '-b', 'feature'])
  writeFileSync(join(root, 'b.txt'), 'b')
  exec(root, 'git', ['add', '.'])
  exec(root, 'git', ['commit', '-m', 'second'])
  exec(root, 'git', ['checkout', 'main'])
  exec(root, 'git', ['push', '-u', 'origin', 'main'])
  exec(root, 'git', ['fetch', 'origin'])
  exec(root, 'git', ['checkout', 'feature'])
  return root
}

function gitHead(root: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 })
  if (r.status !== 0) throw new Error(`git rev-parse failed: ${r.stderr ?? ''}`)
  return r.stdout.trim()
}

function setupForTest(root: string, fixture: Fixture, logPath?: string): Record<string, string> {
  const binDir = join(root, 'bin')
  mkdirSync(binDir, { recursive: true })
  const ghShim = join(binDir, 'gh')
  writeFileSync(ghShim, '#!/bin/sh\nexec bun "$FAKE_GH_SCRIPT" "$@"\n')
  chmodSync(ghShim, 0o755)
  const fixturePath = join(root, 'fixture.json')
  writeFileSync(fixturePath, JSON.stringify(fixture))
  const env: Record<string, string> = {
    FAKE_GH_SCRIPT: fakeGhPath,
    FAKE_GH_FIXTURE: fixturePath,
    PATH: `${binDir}:${process.env.PATH ?? ''}`
  }
  if (logPath) env.FAKE_GH_LOG = logPath
  return env
}

function runHookRaw(hookName: string, root: string, input: string, env: Record<string, string>) {
  return spawnSync('bun', [join(hooksDir, `${hookName}.ts`)], {
    cwd: root,
    input,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10000
  })
}

function runHook(hookName: string, root: string, payload: object, env: Record<string, string>) {
  return runHookRaw(hookName, root, JSON.stringify(payload), env)
}

function readJson(root: string, relative: string): unknown {
  const target = join(root, '.dkm', relative)
  if (!existsSync(target)) return undefined
  return JSON.parse(readFileSync(target, 'utf8')) as unknown
}

function readJsonl(root: string, relative: string): Record<string, unknown>[] {
  const target = join(root, '.dkm', relative)
  if (!existsSync(target)) return []
  return readFileSync(target, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => asRecord(JSON.parse(line) as unknown))
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('expected object')
  return value as Record<string, unknown>
}

/**
 * Bindings used to be written by a WorktreeCreate hook. That hook is gone: Claude Code's
 * WorktreeCreate is a *provider* — it is expected to create the worktree and echo its path, and a
 * hook that echoes nothing aborts worktree creation. Binding now goes through the CLI, which is
 * what `/dkm-bind` runs, so these tests bind the way a session actually does.
 */
function bind(root: string, number: number, env: Record<string, string>): void {
  const r = spawnSync('bun', [join(projectRoot, 'src', 'cli.ts'), 'bind', String(number)], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10000
  })
  if (r.status !== 0) throw new Error(`bind failed: ${r.stderr ?? ''}`)
}

const boundIssue = JSON.stringify({ id: 'PR_1', number: 42, isPr: true })

function bindFixture(): Fixture {
  return { 'issue-get': [{ stdout: boundIssue }], 'repo-view': [{ stdout: 'R_1' }] }
}

test('3. permission-request allows a plainly safe tool', () => {
  const root = makeRepo()
  try {
    mkdirSync(join(root, '.dkm'), { recursive: true })
    writeFileSync(join(root, '.dkm', 'policy.toml'), '[[allow]]\ntool = "Bash"\nmatch = "bun test"\n')
    const env = setupForTest(root, {})
    const r = runHook(
      'permission-request',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'bun test' }
      },
      env
    )
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } }
    })
    const lines = readJsonl(root, 'decisions.jsonl')
    expect(lines).toHaveLength(1)
    const record = lines[0]
    expect(record).toBeDefined()
    if (record === undefined) throw new Error('no decision')
    expect(record.decision).toBe('allow')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('4. permission-request asks on curl', () => {
  const root = makeRepo()
  try {
    mkdirSync(join(root, '.dkm'), { recursive: true })
    const env = setupForTest(root, {})
    const r = runHook(
      'permission-request',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'curl https://example.com' }
      },
      env
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('{}')
    const lines = readJsonl(root, 'decisions.jsonl')
    expect(lines).toHaveLength(1)
    const record = lines[0]
    expect(record).toBeDefined()
    if (record === undefined) throw new Error('no decision')
    const rule = typeof record.rule === 'string' ? record.rule : ''
    expect(rule).toMatch(/^blast:/)
    expect(record.decision).toBe('ask')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('5. permission-request asks with no policy', () => {
  const root = makeRepo()
  try {
    const env = setupForTest(root, {})
    const r = runHook(
      'permission-request',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'ls' }
      },
      env
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('{}')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('5b. permission-request denies a write outside the worktree', () => {
  const root = makeRepo()
  try {
    const env = setupForTest(root, {})
    const r = runHook(
      'permission-request',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'PermissionRequest',
        tool_name: 'Write',
        tool_input: { file_path: '/etc/passwd' }
      },
      env
    )
    expect(r.status).toBe(0)
    const out = asRecord(JSON.parse(r.stdout))
    const specific = asRecord(out.hookSpecificOutput)
    expect(specific.hookEventName).toBe('PermissionRequest')
    const decision = asRecord(specific.decision)
    expect(decision.behavior).toBe('deny')
    expect(decision.message).toBe('DKM blast:outside-worktree')
    const record = readJsonl(root, 'decisions.jsonl')[0]
    expect(record).toBeDefined()
    if (record === undefined) throw new Error('no decision')
    expect(record.decision).toBe('deny')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('5c. permission-request hands the prompt back when it crashes mid-decision', () => {
  const root = makeRepo()
  try {
    // `.dkm` as a regular file makes appendDecision throw, which is the only way to reach the
    // catch. A malformed payload does not: that returns early down the normal `ask` path, so a
    // test built on one would pass while the crash path silently emitted anything at all.
    writeFileSync(join(root, '.dkm'), 'not a directory')
    const env = setupForTest(root, {})
    const r = runHook(
      'permission-request',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'PermissionRequest',
        tool_name: 'Read',
        tool_input: { file_path: join(root, 'a.txt') }
      },
      env
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('{}')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('6. stop with no binding is silent', () => {
  const root = makeRepo()
  try {
    const env = setupForTest(root, {})
    const r = runHook('stop', root, { session_id: 's1', cwd: root, hook_event_name: 'Stop' }, env)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(existsSync(join(root, '.dkm'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('7. stop emits on a changed head', () => {
  const root = makeRepo()
  try {
    const logPath = join(root, 'gh.log')
    const env = setupForTest(
      root,
      {
        'issue-get': [{ stdout: boundIssue }],
        'repo-view': [{ stdout: 'R_1' }],
        'check-runs': [{ stdout: emptyChecks }],
        'comment-list': [{ stdout: emptyComments }],
        'comment-create': [{ stdout: newComment }]
      },
      logPath
    )
    bind(root, 42, env)
    const head = gitHead(root)
    const r = runHook('stop', root, { session_id: 's1', cwd: root, hook_event_name: 'Stop' }, env)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')

    const last = asRecord(readJson(root, 'last-emit.json'))
    const emitted = asRecord(last.emitted)
    const state = emitted['PR_1']
    expect(state).toBeDefined()
    if (typeof state !== 'object' || state === null) throw new Error('no state')
    const s = asRecord(state)
    expect(s.head).toBe(head)
    expect(s.commentId).toBe('12345')

    expect(existsSync(logPath)).toBe(true)
    const logLines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line !== '').length
    expect(logLines).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('7b. a blocker recorded by the CLI reaches the receipt for that session', () => {
  const root = makeRepo()
  try {
    const logPath = join(root, 'gh.log')
    const env = setupForTest(
      root,
      {
        'issue-get': [{ stdout: boundIssue }],
        'repo-view': [{ stdout: 'R_1' }],
        'check-runs': [{ stdout: emptyChecks }],
        'comment-list': [{ stdout: emptyComments }],
        'comment-create': [{ stdout: newComment }]
      },
      logPath
    )
    bind(root, 42, env)
    // The session id has to be the one the harness exports, or the report lands in a file the Stop
    // hook never opens and the blocker is dropped without a trace.
    const noted = spawnSync('bun', [join(projectRoot, 'src', 'cli.ts'), 'blocker', 'needs a human call'], {
      cwd: root,
      env: { ...process.env, ...env, CLAUDE_CODE_SESSION_ID: 's1' },
      encoding: 'utf8',
      timeout: 10000
    })
    expect(noted.status).toBe(0)

    const r = runHook('stop', root, { session_id: 's1', cwd: root, hook_event_name: 'Stop' }, env)
    expect(r.status).toBe(0)
    const logged = asRecord(JSON.parse(readFileSync(logPath, 'utf8').split('\n')[0] ?? '{}'))
    expect(String(logged.input)).toContain('needs a human call')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("7c. the decision summary counts the turn, not the session's whole lifetime", () => {
  const root = makeRepo()
  try {
    const logPath = join(root, 'gh.log')
    const env = setupForTest(
      root,
      {
        'issue-get': [{ stdout: boundIssue }],
        'repo-view': [{ stdout: 'R_1' }],
        'check-runs': [{ stdout: emptyChecks }, { stdout: emptyChecks }],
        'comment-list': [{ stdout: emptyComments }, { stdout: existingComment }],
        'comment-create': [{ stdout: newComment }],
        'comment-patch': [{ stdout: newComment }]
      },
      logPath
    )
    bind(root, 42, env)

    const decide = (command: string) =>
      runHook(
        'permission-request',
        root,
        {
          session_id: 's1',
          cwd: root,
          hook_event_name: 'PermissionRequest',
          tool_name: 'Bash',
          tool_input: { command }
        },
        env
      )

    decide('ls one')
    decide('ls two')
    runHook('stop', root, { session_id: 's1', cwd: root, hook_event_name: 'Stop' }, env)

    // Move head so the second Stop is a real delta rather than a no-op.
    writeFileSync(join(root, 'c.txt'), 'c')
    exec(root, 'git', ['add', '.'])
    exec(root, 'git', ['commit', '-m', 'third'])

    decide('ls three')
    runHook('stop', root, { session_id: 's1', cwd: root, hook_event_name: 'Stop' }, env)

    const emits = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => asRecord(JSON.parse(l)))
    expect(emits).toHaveLength(2)
    const body = String(asRecord(JSON.parse(String(emits[1]?.input))).body)
    // Three decisions exist by now; the second receipt describes only the one its turn produced.
    expect(body).toContain('**0 allowed, 0 denied, 1 asked**')
    expect(body).not.toContain('3 asked')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('8. stop is idempotent when state is unchanged', () => {
  const root = makeRepo()
  try {
    const logPath = join(root, 'gh.log')
    // Queued deep enough for TWO complete emits. If the fixtures ran out, the second pass would fail
    // on an exhausted queue and this test would pass without proving anything about the delta check.
    const env = setupForTest(
      root,
      {
        'issue-get': [{ stdout: boundIssue }],
        'repo-view': [{ stdout: 'R_1' }],
        'check-runs': [{ stdout: emptyChecks }, { stdout: emptyChecks }],
        'comment-list': [{ stdout: emptyComments }, { stdout: existingComment }],
        'comment-create': [{ stdout: newComment }],
        'comment-patch': [{ stdout: newComment }]
      },
      logPath
    )
    bind(root, 42, env)
    const r1 = runHook('stop', root, { session_id: 's1', cwd: root, hook_event_name: 'Stop' }, env)
    expect(r1.status).toBe(0)
    const r2 = runHook('stop', root, { session_id: 's1', cwd: root, hook_event_name: 'Stop' }, env)
    expect(r2.status).toBe(0)

    const log = readFileSync(logPath, 'utf8')
    expect(log.split('\n').filter((line) => line !== '').length).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('9. stop with stop_hook_active true bails out', () => {
  const root = makeRepo()
  try {
    const logPath = join(root, 'gh.log')
    const env = setupForTest(root, bindFixture(), logPath)
    bind(root, 42, env)
    const r = runHook(
      'stop',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'Stop',
        stop_hook_active: true
      },
      env
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(existsSync(join(root, '.dkm', 'last-emit.json'))).toBe(false)
    expect(existsSync(logPath)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('10. session-start drains pending events', () => {
  const root = makeRepo()
  try {
    const pending: PendingEvent = {
      eventId: 'ev1',
      rootId: 'ev1',
      hops: 0,
      tier: 'bound',
      workItem: { repoNodeId: 'R_1', itemNodeId: 'I_1', number: 1, kind: 'issue' },
      observedAt: '2026-09-03T00:00:00Z',
      headline: 'Example issue',
      url: 'https://github.com/owner/repo/issues/1',
      receipt: null
    }
    mkdirSync(join(root, '.dkm', 'pending'), { recursive: true })
    writeFileSync(join(root, '.dkm', 'pending', 'ev1.json'), JSON.stringify(pending))
    const env = setupForTest(root, {})
    const r = runHook('session-start', root, { session_id: 's1', cwd: root, hook_event_name: 'SessionStart' }, env)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Example issue')
    expect(r.stdout).toContain('https://github.com/owner/repo/issues/1')
    expect(readdirSync(join(root, '.dkm', 'pending'))).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('10b. a followed item arrives as a contract delta, not a headline', () => {
  const root = makeRepo()
  try {
    const followed = { repoNodeId: 'R_1', itemNodeId: 'I_7', number: 7, kind: 'issue' as const }
    const receipt: Receipt = {
      eventId: 'ev-1',
      workItem: followed,
      base: '1111111111111111111111111111111111111111',
      head: '2222222222222222222222222222222222222222',
      changedPaths: [{ status: 'M', path: 'src/types.ts' }],
      checks: [{ checkRunId: '1', name: 'ci', attempt: 1, conclusion: 'success' }],
      contractDelta: ['src/types.ts'],
      decisions: { allowed: 2, denied: 0, asked: 1 },
      blockers: ['two shapes for the retry policy'],
      narrative: 'reshaped the widget contract',
      observedAt: '2026-09-03T00:00:00Z'
    }
    const issueList = JSON.stringify([
      {
        node_id: 'I_7',
        number: 7,
        title: 'Contract owner',
        html_url: 'https://github.com/owner/repo/issues/7',
        updated_at: '2026-09-03T02:00:00Z'
      }
    ])
    const env = setupForTest(root, {
      'issue-get': [{ stdout: JSON.stringify({ id: 'I_7', number: 7, isPr: false }) }],
      'repo-view': [{ stdout: 'R_1' }],
      'issue-list': [{ stdout: issueList }],
      'comment-list': [{ stdout: JSON.stringify([{ id: 99, body: renderReceipt(receipt) }]) }]
    })
    const r = spawnSync('bun', [join(projectRoot, 'src', 'cli.ts'), 'follow', '7'], {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 10000
    })
    expect(r.status).toBe(0)

    const out = runHook('session-start', root, { session_id: 's1', cwd: root, hook_event_name: 'SessionStart' }, env)
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('followed:')
    expect(out.stdout).toContain('1111111 → 2222222')
    expect(out.stdout).toContain('contract: src/types.ts')
    expect(out.stdout).toContain('two shapes for the retry policy')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('12. session-end leaves a ticket naming the session that just ended', () => {
  const root = makeRepo()
  try {
    const env = setupForTest(root, {})
    const r = runHook(
      'session-end',
      root,
      { session_id: 'sess-42', cwd: root, hook_event_name: 'SessionEnd', reason: 'other' },
      env
    )
    expect(r.status).toBe(0)
    const ticket = asRecord(readJson(root, 'last-session.json'))
    expect(ticket.sessionId).toBe('sess-42')
    // The reason is recorded as the harness gave it. A hook cannot tell a usage limit from a clean
    // exit, and guessing at one is how a supervisor would resume a session nobody wanted resumed.
    expect(ticket.reason).toBe('other')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const HOOKS = ['stop', 'session-start', 'user-prompt-submit', 'permission-request'] as const

for (const hook of HOOKS) {
  test(`11. ${hook} fails open on malformed JSON`, () => {
    const root = makeRepo()
    try {
      const env = setupForTest(root, {})
      const r = runHookRaw(hook, root, '{not json}', env)
      expect(r.status).toBe(0)
      expect(existsSync(join(root, '.dkm'))).toBe(false)
      // A malformed decision is read by the harness as a hook failure, which denies the tool. The
      // only safe output from a broken permission hook is no decision at all.
      if (hook === 'permission-request') expect(r.stdout).toBe('{}')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
