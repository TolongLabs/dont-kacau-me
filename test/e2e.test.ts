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
import type { PendingEvent } from '../src/types'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const hooksDir = join(projectRoot, 'src', 'hooks')
const fakeGhPath = join(projectRoot, 'test', 'fake-gh.ts')

type Fixture = Record<string, Array<{ stdout: string; status?: number; stderr?: string }>>

const samplePr = JSON.stringify([{ id: 'PR_1', number: 42, headRepository: { id: 'R_1' } }])
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

test('1. worktree-create binds a worktree', () => {
  const root = makeRepo()
  try {
    const env = setupForTest(root, { 'pr-list': [{ stdout: samplePr }] })
    const r = runHook(
      'worktree-create',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'WorktreeCreate',
        worktree_path: root,
        branch: 'feature'
      },
      env
    )
    expect(r.status).toBe(0)

    const file = asRecord(readJson(root, 'bindings.json'))
    const list = file.bindings
    expect(Array.isArray(list)).toBe(true)
    if (!Array.isArray(list)) throw new Error('bindings not an array')
    expect(list).toHaveLength(1)
    const binding = list[0]
    expect(binding).toBeDefined()
    if (typeof binding !== 'object' || binding === null) throw new Error('binding missing')
    const b = asRecord(binding)
    expect(b.worktreePath).toBe(root)
    expect(b.bound).toEqual({ repoNodeId: 'R_1', itemNodeId: 'PR_1', number: 42, kind: 'pr' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('2. worktree-remove releases that binding', () => {
  const root = makeRepo()
  try {
    const env = setupForTest(root, { 'pr-list': [{ stdout: samplePr }] })
    runHook(
      'worktree-create',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'WorktreeCreate',
        worktree_path: root,
        branch: 'feature'
      },
      env
    )
    const r = runHook(
      'worktree-remove',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'WorktreeRemove',
        worktree_path: root
      },
      env
    )
    expect(r.status).toBe(0)
    const file = asRecord(readJson(root, 'bindings.json'))
    expect(file.bindings).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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
    expect(r.stdout).toBe(JSON.stringify({ hookSpecificOutput: { decision: 'allow' } }))
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
    expect(r.stdout).toBe(JSON.stringify({ hookSpecificOutput: { decision: 'ask' } }))
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
    expect(r.stdout).toBe(JSON.stringify({ hookSpecificOutput: { decision: 'ask' } }))
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
        'pr-list': [{ stdout: samplePr }],
        'check-runs': [{ stdout: emptyChecks }],
        'comment-list': [{ stdout: emptyComments }],
        'comment-create': [{ stdout: newComment }]
      },
      logPath
    )
    runHook(
      'worktree-create',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'WorktreeCreate',
        worktree_path: root,
        branch: 'feature'
      },
      env
    )
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

test('8. stop is idempotent when state is unchanged', () => {
  const root = makeRepo()
  try {
    const logPath = join(root, 'gh.log')
    // Queued deep enough for TWO complete emits. If the fixtures ran out, the second pass would fail
    // on an exhausted queue and this test would pass without proving anything about the delta check.
    const env = setupForTest(
      root,
      {
        'pr-list': [{ stdout: samplePr }],
        'check-runs': [{ stdout: emptyChecks }, { stdout: emptyChecks }],
        'comment-list': [{ stdout: emptyComments }, { stdout: existingComment }],
        'comment-create': [{ stdout: newComment }],
        'comment-patch': [{ stdout: newComment }]
      },
      logPath
    )
    runHook(
      'worktree-create',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'WorktreeCreate',
        worktree_path: root,
        branch: 'feature'
      },
      env
    )
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
    const env = setupForTest(root, { 'pr-list': [{ stdout: samplePr }] }, logPath)
    runHook(
      'worktree-create',
      root,
      {
        session_id: 's1',
        cwd: root,
        hook_event_name: 'WorktreeCreate',
        worktree_path: root,
        branch: 'feature'
      },
      env
    )
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

const HOOKS = [
  'worktree-create',
  'worktree-remove',
  'stop',
  'session-start',
  'user-prompt-submit',
  'permission-request'
] as const

for (const hook of HOOKS) {
  test(`11. ${hook} fails open on malformed JSON`, () => {
    const root = makeRepo()
    try {
      const env = setupForTest(root, {})
      const r = runHookRaw(hook, root, '{not json}', env)
      expect(r.status).toBe(0)
      expect(existsSync(join(root, '.dkm'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
