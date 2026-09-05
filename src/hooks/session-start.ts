import { registerSession } from '../store'
import { drainAndRender, ingest, permissionModeHint, unboundHint } from './inject'
import { runHook } from './runtime'

runHook((payload, root) => {
  registerSession(root, payload.session_id, root)
  ingest(root)
  return `${permissionModeHint(root, payload.permission_mode)}${unboundHint(root)}${drainAndRender(root, payload.session_id)}`
})
