import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dkmPath } from '../store'

export type HookPayload = {
  session_id: string
  cwd: string
  hook_event_name: string
  permission_mode?: string
  stop_hook_active?: boolean
  tool_name?: string
  tool_input?: unknown
  reason?: string
}

export function readPayload(raw: string): HookPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Record<string, unknown>
    if (typeof p.session_id !== 'string' || typeof p.cwd !== 'string') return null
    return parsed as HookPayload
  } catch {
    return null
  }
}

export function repoRoot(cwd: string): string | null {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 5000 })
  if (r.status !== 0 || typeof r.stdout !== 'string') return null
  const out = r.stdout.trim()
  return out.length > 0 ? out : null
}

/**
 * The plugin is installed once per machine, so its hooks run in every git repository the user opens.
 * Nothing happens in one until `dkm init` or `dkm bind` created `.dkm/` there: before this gate a
 * repository nobody opted in still paid for GitHub calls on its first prompt, collected session
 * records, and in an asking mode was fenced by a policy that did not exist.
 */
export function installed(root: string): boolean {
  return existsSync(dkmPath(root))
}

export async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Every hook fails open. A DKM defect must never wedge a session, so the handler's exceptions are
 * swallowed and the process still exits 0 with whatever the fallback produced.
 */
export async function runHook(handler: (p: HookPayload, root: string) => string | Promise<string>): Promise<void> {
  let out = ''
  try {
    const payload = readPayload(await readStdin())
    if (payload !== null) {
      const root = repoRoot(payload.cwd)
      if (root !== null) out = await handler(payload, root)
    }
  } catch {
    out = ''
  }
  if (out.length > 0) process.stdout.write(out)
  process.exit(0)
}
