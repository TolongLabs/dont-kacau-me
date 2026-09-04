import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { decide } from './decide'
import type { DecisionInput, Policy } from './types'

const WORKTREE = '/home/dev/repo'

const EMPTY_POLICY: Policy = { version: 1, allow: [], contractGlobs: [] }

function bash(command: string): DecisionInput {
  return { sessionId: 's1', cwd: WORKTREE, worktreePath: WORKTREE, toolName: 'Bash', toolInput: { command } }
}

function write(filePath: string): DecisionInput {
  return {
    sessionId: 's1',
    cwd: WORKTREE,
    worktreePath: WORKTREE,
    toolName: 'Write',
    toolInput: { file_path: filePath }
  }
}

test('outside-worktree denies, and resolves .. before comparing', () => {
  expect(decide(write(`${WORKTREE}/../../etc/passwd`), EMPTY_POLICY)).toMatchObject({
    decision: 'deny',
    trip: 'outside-worktree'
  })
  expect(decide(write('/etc/passwd'), EMPTY_POLICY).decision).toBe('deny')
})

test('a path inside the worktree is not an outside-worktree trip', () => {
  expect(decide(write(`${WORKTREE}/src/a.ts`), EMPTY_POLICY).trip).not.toBe('outside-worktree')
})

test('data-loss trips ask', () => {
  for (const cmd of ['rm -rf build', 'psql -c "DROP TABLE users"', 'psql -c "DELETE FROM sessions"']) {
    expect(decide(bash(cmd), EMPTY_POLICY)).toMatchObject({ decision: 'ask', trip: 'data-loss' })
  }
  expect(decide(write(`${WORKTREE}/drizzle/0001_init.sql`), EMPTY_POLICY).trip).toBe('data-loss')
})

test('a harmless command is not a data-loss trip', () => {
  expect(decide(bash('bun test'), EMPTY_POLICY).trip).toBeNull()
})

test('egress trips ask', () => {
  for (const cmd of ['curl https://example.com', 'git push origin feature', 'gh pr create --title x']) {
    expect(decide(bash(cmd), EMPTY_POLICY)).toMatchObject({ decision: 'ask', trip: 'egress' })
  }
})

test('reading with gh is not an egress trip', () => {
  expect(decide(bash('gh pr view 12 --json title'), EMPTY_POLICY).trip).not.toBe('egress')
})

test('surface trips ask for lockfiles, env files and package.json', () => {
  for (const p of ['bun.lock', 'package-lock.json', '.env', '.env.local', 'package.json']) {
    expect(decide(write(`${WORKTREE}/${p}`), EMPTY_POLICY)).toMatchObject({ decision: 'ask', trip: 'surface' })
  }
})

test('the grant cannot be rewritten without the human seeing it', () => {
  // A permissive allow rule must not reach .dkm/. Otherwise an agent widens its own authority by
  // editing the file that grants it, which is the one thing the authority principle forbids.
  const permissive: Policy = { version: 1, allow: [{ tool: 'Write' }, { tool: 'Edit' }], contractGlobs: [] }
  for (const p of ['.dkm/policy.toml', '.dkm/decisions.jsonl', '.dkm/bindings.json']) {
    expect(decide(write(`${WORKTREE}/${p}`), permissive)).toMatchObject({ decision: 'ask', trip: 'surface' })
  }
})

test('an ordinary source write is not a surface trip', () => {
  expect(decide(write(`${WORKTREE}/src/index.ts`), EMPTY_POLICY).trip).toBeNull()
})

test('a policy allow rule on tool alone allows', () => {
  const policy: Policy = { version: 1, allow: [{ tool: 'Bash' }], contractGlobs: [] }
  expect(decide(bash('bun test'), policy)).toMatchObject({ decision: 'allow', rule: 'policy.allow[0]' })
})

test('a policy allow rule with match only allows the matching command', () => {
  const policy: Policy = { version: 1, allow: [{ tool: 'Bash', match: 'bun test' }], contractGlobs: [] }
  expect(decide(bash('bun test'), policy).decision).toBe('allow')
  expect(decide(bash('bun run build'), policy).decision).toBe('ask')
})

test('a policy allow rule with paths allows only matching paths', () => {
  const policy: Policy = { version: 1, allow: [{ tool: 'Write', paths: ['src/**'] }], contractGlobs: [] }
  expect(decide(write(`${WORKTREE}/src/deep/a.ts`), policy).decision).toBe('allow')
  expect(decide(write(`${WORKTREE}/docs/a.md`), policy).decision).toBe('ask')
})

test('a blast-radius trip beats a policy allow rule that would otherwise match', () => {
  const policy: Policy = { version: 1, allow: [{ tool: 'Bash' }], contractGlobs: [] }
  expect(decide(bash('curl https://example.com'), policy)).toMatchObject({ decision: 'ask', trip: 'egress' })
})

test('the default is ask', () => {
  expect(decide(bash('some-unknown-tool --flag'), EMPTY_POLICY)).toMatchObject({ decision: 'ask', rule: 'default' })
})

/**
 * NFR-AUTH. The engine must be a pure function of (input, policy). If it could read inbound state it
 * could turn a peer's message into a permission grant, which is the one thing the product must never
 * do. Asserted against the source text so that adding the import fails the build, not a review.
 */
test('decide.ts never reads inbound state', () => {
  const source = readFileSync(new URL('./decide.ts', import.meta.url), 'utf8')
  const imports = source.match(/^import[^\n]*$/gm) ?? []
  for (const line of imports) {
    expect(line).not.toMatch(/['"]\.\/store['"]/)
    expect(line).not.toMatch(/['"]\.\/github['"]/)
    expect(line).not.toMatch(/hooks\//)
  }
  expect(source).not.toMatch(/\.dkm\/pending/)
  expect(source).not.toMatch(/readFileSync|readFile|fetch\(|spawnSync/)
})

function tool(toolName: string, toolInput: unknown): DecisionInput {
  return { sessionId: 's1', cwd: WORKTREE, worktreePath: WORKTREE, toolName, toolInput }
}

test('prose that mentions an absolute path is not a filesystem access', () => {
  // These were denied outright, and outside-worktree is the one trip with no human fallback: the
  // call simply fails. A search query, a todo and a question are text, not a path.
  expect(decide(tool('WebSearch', { query: 'best practices for /etc/hosts' }), EMPTY_POLICY).decision).toBe('ask')
  expect(
    decide(tool('TodoWrite', { todos: [{ content: 'document the /usr/local path' }] }), EMPTY_POLICY).decision
  ).toBe('ask')
  expect(
    decide(tool('AskUserQuestion', { questions: [{ options: [{ description: 'add /dkm-init' }] }] }), EMPTY_POLICY)
      .decision
  ).toBe('ask')
})

test('file content is not a path, however it reads', () => {
  const input = tool('Write', { file_path: `${WORKTREE}/src/notes.md`, content: 'we should never touch /etc/passwd' })
  expect(decide(input, EMPTY_POLICY).trip).toBe(null)
})

test('a structured path field outside the worktree is still denied', () => {
  expect(decide(write('/etc/passwd'), EMPTY_POLICY).decision).toBe('deny')
  expect(decide(tool('NotebookEdit', { notebook_path: '/tmp/x.ipynb' }), EMPTY_POLICY).decision).toBe('deny')
})

test('a nested edit target outside the worktree is still denied', () => {
  // Reached through an array under `edits`, which a shallow field read would miss.
  const input = tool('MultiEdit', { edits: [{ file_path: `${WORKTREE}/src/a.ts` }, { file_path: '/etc/hosts' }] })
  expect(decide(input, EMPTY_POLICY).decision).toBe('deny')
})

test('bash still has its whole command scanned for paths', () => {
  // The command text genuinely is the path list, so token scanning stays.
  expect(decide(bash('cat /etc/passwd'), EMPTY_POLICY).decision).toBe('deny')
  expect(decide(bash('sed -i s/x/y/ .dkm/policy.toml'), EMPTY_POLICY).rule).toBe('blast:surface')
})

test('a prose field whose whole value is a path is still prose', () => {
  // The exact shape that was denied live: an option label that is just the slash command it offers.
  // A test whose prose merely contains a path passes even without the key allowlist, because the
  // surrounding words make the string resolve relative to the worktree.
  const question = tool('AskUserQuestion', { questions: [{ options: [{ label: '/dkm-init' }] }] })
  expect(decide(question, EMPTY_POLICY).decision).toBe('ask')
  expect(decide(tool('WebSearch', { query: '/etc/hosts' }), EMPTY_POLICY).decision).toBe('ask')

  const write = tool('Write', { file_path: `${WORKTREE}/src/a.ts`, content: '/etc/passwd' })
  expect(decide(write, EMPTY_POLICY).trip).toBe(null)
})
