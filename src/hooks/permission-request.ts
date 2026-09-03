import { decide } from '../decide'
import { loadPolicy } from '../policy'
import { appendDecision } from '../store'
import type { DecisionRecord, PermissionDecision } from '../types'
import { readPayload, readStdin, repoRoot } from './runtime'

function emit(decision: PermissionDecision): never {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { decision } }))
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
  if (payload === null || typeof payload.tool_name !== 'string') emit('ask')

  const root = repoRoot(payload.cwd)
  if (root === null) emit('ask')

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
  emit(verdict.decision)
}

main().catch(() => {
  emit('ask')
})
