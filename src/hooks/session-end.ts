import { writeResumeTicket } from '../store'
import { runHook } from './runtime'

/**
 * A session that ends leaves behind the one fact a supervisor needs to pick the work back up: which
 * session it was. The reason is recorded as the harness gave it, unexamined, because a hook cannot
 * tell a usage limit from a clean exit and must not guess at one.
 */
runHook((payload, root) => {
  writeResumeTicket(root, {
    sessionId: payload.session_id,
    cwd: payload.cwd,
    reason: typeof payload.reason === 'string' ? payload.reason : 'unknown',
    endedAt: new Date().toISOString()
  })
  return ''
})
