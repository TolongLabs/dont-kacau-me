import { registerSession } from '../store'
import { drainAndRender, ingest, unboundHint } from './inject'
import { installed, runHook } from './runtime'

// Plain stdout from this hook is shown to the human, so this is the one line a new user sees.
const NOT_SET_UP = '⟨dkm⟩ not set up in this repository. Run /dont-kacau-me:dkm-init to start.\n'

runHook((payload, root) => {
  if (!installed(root)) return NOT_SET_UP
  registerSession(root, payload.session_id, root)
  ingest(root)
  return `${unboundHint(root)}${drainAndRender(root, payload.session_id)}`
})
