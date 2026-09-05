import { registerSession } from '../store'
import { drainAndRender, ingest } from './inject'
import { runHook } from './runtime'

const REFETCH_INTERVAL_MS = 120_000

runHook((payload, root) => {
  // Registering again is a touch when the record exists, and a recovery when a session started
  // before this version was installed and has no record yet.
  registerSession(root, payload.session_id, root)
  ingest(root, REFETCH_INTERVAL_MS)
  return drainAndRender(root, payload.session_id)
})
