import { drainAndRender, ingest, unboundHint } from './inject'
import { runHook } from './runtime'

runHook((_payload, root) => {
  ingest(root)
  return `${unboundHint(root)}${drainAndRender(root)}`
})
