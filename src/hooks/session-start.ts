import { drainAndRender, ingest, permissionModeHint, unboundHint } from './inject'
import { runHook } from './runtime'

runHook((payload, root) => {
  ingest(root)
  return `${permissionModeHint(root, payload.permission_mode)}${unboundHint(root)}${drainAndRender(root)}`
})
