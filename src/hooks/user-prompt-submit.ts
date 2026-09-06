import { registerSession } from '../store'
import { drainAndRender, ingest, permissionModeHint } from './inject'
import { installed, runHook } from './runtime'

const REFETCH_INTERVAL_MS = 300_000
const BUDGET_MS = 5000

runHook((payload, root) => {
  if (!installed(root)) return ''
  // Registering again is a touch when the record exists, and a recovery when a session started
  // before this version was installed and has no record yet.
  registerSession(root, payload.session_id, root)
  ingest(root, REFETCH_INTERVAL_MS, BUDGET_MS, Date.now, false)
  return `${permissionModeHint(root, payload.session_id, payload.permission_mode)}${drainAndRender(root, payload.session_id)}`
})
