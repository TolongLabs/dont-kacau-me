import { spawnSync } from 'node:child_process'

export type HookPayload = {
  session_id: string
  cwd: string
  hook_event_name: string
  permission_mode?: string
  stop_hook_active?: boolean
  tool_name?: string
  tool_input?: unknown
  worktree_path?: string
  branch?: string
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
