import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(join(root, relative), 'utf8'))
}

test('the plugin manifest is valid and names the repository', () => {
  const manifest = readJson('.claude-plugin/plugin.json') as Record<string, unknown>
  expect(manifest.name).toBe('dont-kacau-me')
  expect(typeof manifest.version).toBe('string')
  expect(typeof manifest.description).toBe('string')
})

/**
 * A hook command pointing at a path that does not exist fails silently: the shell guard short-circuits,
 * the hook is a no-op, and a session looks healthy while DKM does nothing. That is the exact failure
 * mode this product exists to prevent, so it is asserted rather than trusted.
 */
test('every hook command points at a handler that exists', () => {
  const declared = readJson('hooks/hooks.json') as { hooks: Record<string, { hooks: { command: string }[] }[]> }
  const events = Object.keys(declared.hooks)
  expect(events.length).toBeGreaterThan(0)

  for (const event of events) {
    for (const entry of declared.hooks[event] ?? []) {
      for (const hook of entry.hooks) {
        const match = hook.command.match(/src\/hooks\/([a-z-]+)\.ts/)
        expect(match?.[1]).toBeDefined()
        const handler = join(root, 'src', 'hooks', `${match?.[1]}.ts`)
        expect(existsSync(handler)).toBe(true)
      }
      for (const hook of entry.hooks) {
        expect(hook.command).toContain('${CLAUDE_PLUGIN_ROOT}')
      }
    }
  }
})

test('every declared hook event is one the harness actually emits', () => {
  const known = [
    'PermissionRequest',
    'Stop',
    'SessionStart',
    'UserPromptSubmit',
    'WorktreeCreate',
    'WorktreeRemove',
    'PreToolUse',
    'PostToolUse',
    'Notification'
  ]
  const declared = readJson('hooks/hooks.json') as { hooks: Record<string, unknown> }
  for (const event of Object.keys(declared.hooks)) expect(known).toContain(event)
})

test('every slash command invokes the CLI through the plugin root', () => {
  const dir = join(root, 'commands')
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    const body = readFileSync(join(dir, file), 'utf8')
    expect(body.startsWith('---')).toBe(true)
    expect(body).toContain('description:')
    expect(body).toContain('${CLAUDE_PLUGIN_ROOT}')
  }
})

test('the committed policy parses and grants nothing that trips a blast-radius rule', () => {
  const policy = readFileSync(join(root, '.dkm', 'policy.toml'), 'utf8')
  expect(policy).toContain('version = 1')
  expect(policy).toContain('[[allow]]')
  expect(policy).not.toMatch(/match\s*=\s*"(curl|git push|npm publish|rm -rf)/)
})
