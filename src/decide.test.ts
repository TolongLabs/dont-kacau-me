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
