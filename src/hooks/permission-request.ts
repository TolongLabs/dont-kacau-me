import { decide } from '../decide'
import { loadPolicy } from '../policy'
import { appendDecision } from '../store'
import type { DecisionRecord, PermissionDecision } from '../types'
import { readPayload, readStdin, repoRoot } from './runtime'

/**
 * The harness validates this payload against its own schema and treats a mismatch as a hook
 * failure, which denies the tool. A malformed "allow" is therefore not a no-op; it is a deny the
 * installer never asked for. `ask` has no wire form of its own: emitting no decision is what hands
 * the prompt back to the human, so it is also the only safe thing to emit when we fail.
 */
function emit(decision: PermissionDecision, reason: string): never {
  const body =
    decision === 'ask'
      ? {}
      : {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: reason }
          }
        }
  process.stdout.write(JSON.stringify(body))
  process.exit(0)
}

function summarise(toolName: string, toolInput: unknown): string {
  if (typeof toolInput === 'object' && toolInput !== null) {
    const t = toolInput as Record<string, unknown>
    for (const key of ['command', 'file_path', 'path', 'url']) {
      const v = t[key]
      if (typeof v === 'string') return v.slice(0, 200)
    }
  }
  return toolName
}

async function main(): Promise<void> {
  const payload = readPayload(await readStdin())
  if (payload === null || typeof payload.tool_name !== 'string') emit('ask', '')

  const root = repoRoot(payload.cwd)
  if (root === null) emit('ask', '')

  const policy = loadPolicy(root)
  const verdict = decide(
    {
      sessionId: payload.session_id,
      cwd: payload.cwd,
      worktreePath: root,
      toolName: payload.tool_name,
      toolInput: payload.tool_input
    },
    policy
  )

  const record: DecisionRecord = {
    ts: new Date().toISOString(),
    session: payload.session_id,
    tool: payload.tool_name,
    summary: summarise(payload.tool_name, payload.tool_input),
    decision: verdict.decision,
    rule: verdict.rule,
    reverse: verdict.trip === null ? 'n/a' : `blocked on ${verdict.trip}`
  }

  appendDecision(root, record)
  emit(verdict.decision, `DKM ${verdict.rule}`)
}

main().catch(() => {
  emit('ask', '')
})
