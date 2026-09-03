import { drainAndRender, ingest } from './inject'
import { runHook } from './runtime'

runHook((_payload, root) => {
  ingest(root)
  return drainAndRender(root)
})
