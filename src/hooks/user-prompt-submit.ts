import { drainAndRender, ingest } from './inject'
import { runHook } from './runtime'

const REFETCH_INTERVAL_MS = 120_000

runHook((_payload, root) => {
  ingest(root, REFETCH_INTERVAL_MS)
  return drainAndRender(root)
})
