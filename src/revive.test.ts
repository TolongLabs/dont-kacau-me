import { describe, expect, it } from 'bun:test'
import { classify, MAX_WAIT_MS, MIN_WAIT_MS, parseResetAt, waitFor } from './revive'

const NOW = new Date('2026-09-04T10:00:00.000Z')

function limitOf(outcome: ReturnType<typeof classify>) {
  if (outcome.kind !== 'limit') throw new Error(`expected a limit, got ${outcome.kind}`)
  return outcome
}

describe('classify', () => {
  it('reads a clean run as done and keeps the session id', () => {
    const raw = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's1', result: 'ok' })
    expect(classify(raw, NOW)).toEqual({ kind: 'done', sessionId: 's1', result: 'ok' })
  })

  it('reads api_error_status 429 as a usage limit', () => {
    const raw = JSON.stringify({ is_error: true, api_error_status: 429, session_id: 's2', result: 'stopped' })
    expect(limitOf(classify(raw, NOW)).sessionId).toBe('s2')
  })

  for (const marker of ['limit_reached', 'quota_exceeded', 'rate_limit']) {
    it(`reads terminal_reason ${marker} as a usage limit`, () => {
      const raw = JSON.stringify({ is_error: true, terminal_reason: marker, session_id: 's3' })
      expect(classify(raw, NOW).kind).toBe('limit')
    })
  }

  it('reads a usage limit that only appears in the result prose', () => {
    const raw = JSON.stringify({
      is_error: true,
      session_id: 's4',
      result: 'Usage limit reached. Try again until your limit resets at 2026-09-04T14:30:00Z.'
    })
    const limit = limitOf(classify(raw, NOW))
    expect(limit.resetAt?.toISOString()).toBe('2026-09-04T14:30:00.000Z')
  })

  it('reads a limit out of unparseable output rather than calling it a crash', () => {
    // A run killed mid-flight prints no JSON. Treating that as a crash ends the loop, which is the
    // one failure this module exists to prevent, so the raw text is searched too.
    const outcome = classify('Usage limit reached. Your limit resets at 3pm.\n', NOW)
    expect(outcome.kind).toBe('limit')
  })

  it('reads a genuine error as failed, not as a limit', () => {
    const raw = JSON.stringify({ is_error: true, subtype: 'error_during_execution', session_id: 's5' })
    expect(classify(raw, NOW).kind).toBe('failed')
  })

  it('does not mistake unrelated prose for a limit', () => {
    const raw = JSON.stringify({ is_error: false, subtype: 'success', session_id: 's6', result: 'rate the limit' })
    expect(classify(raw, NOW).kind).toBe('done')
  })
})

describe('parseResetAt', () => {
  it('parses an ISO timestamp', () => {
    expect(parseResetAt('resets at 2026-09-04T14:30:00Z', NOW)?.toISOString()).toBe('2026-09-04T14:30:00.000Z')
  })

  it('parses epoch seconds and milliseconds alike', () => {
    const seconds = parseResetAt('1788556200', NOW)
    const millis = parseResetAt('1788556200000', NOW)
    expect(seconds?.getTime()).toBe(1788556200000)
    expect(millis?.getTime()).toBe(1788556200000)
  })

  it('rolls a clock time that has already passed to tomorrow', () => {
    const now = new Date('2026-09-04T16:00:00.000Z')
    const at = parseResetAt('resets at 9am', now)
    expect(at).not.toBeNull()
    if (at === null) throw new Error('no time')
    expect(at.getTime()).toBeGreaterThan(now.getTime())
  })

  it('returns null when there is no time to read', () => {
    expect(parseResetAt('resets soon', NOW)).toBeNull()
    expect(parseResetAt('', NOW)).toBeNull()
  })
})

describe('waitFor', () => {
  it('waits until the reset the server named', () => {
    const outcome = { kind: 'limit' as const, sessionId: 's1', resetAt: new Date(NOW.getTime() + 90 * 60 * 1000) }
    expect(waitFor(outcome, 1, NOW)).toBe(90 * 60 * 1000 + 30_000)
  })

  it('never sleeps past the cap even when the parsed time is absurd', () => {
    const outcome = { kind: 'limit' as const, sessionId: 's1', resetAt: new Date(NOW.getTime() + 400 * 3600 * 1000) }
    expect(waitFor(outcome, 1, NOW)).toBe(MAX_WAIT_MS)
  })

  it('backs off instead of spinning when the reset time is in the past', () => {
    const outcome = { kind: 'limit' as const, sessionId: 's1', resetAt: new Date(NOW.getTime() - 60_000) }
    expect(waitFor(outcome, 1, NOW)).toBe(MIN_WAIT_MS)
    expect(waitFor(outcome, 3, NOW)).toBe(MIN_WAIT_MS * 4)
  })

  it('backs off exponentially and stays capped with no reset time at all', () => {
    const outcome = { kind: 'limit' as const, sessionId: 's1', resetAt: null }
    expect(waitFor(outcome, 1, NOW)).toBe(MIN_WAIT_MS)
    expect(waitFor(outcome, 2, NOW)).toBe(MIN_WAIT_MS * 2)
    expect(waitFor(outcome, 99, NOW)).toBe(MAX_WAIT_MS)
  })
})
