/**
 * Surviving a usage limit.
 *
 * A long autonomous run ends when the account's usage limit is reached, and everything after that
 * point is simply not done. This module wraps a Claude Code run so that the limit becomes a pause
 * rather than an ending: classify why the run stopped, wait for the window the server itself named,
 * then resume the same session by id.
 *
 * It waits, it never evades. The delay comes from the reset time the harness reported, and when
 * that cannot be read the fallback is a capped exponential backoff. There is no retry that runs
 * sooner than the server said, and no path that changes credentials or account.
 */

const LIMIT_MARKERS = ['limit_reached', 'quota_exceeded', 'rate_limit', 'usage_limit', 'usage limit reached']

export type Outcome =
  | { kind: 'done'; sessionId: string | null; result: string }
  | { kind: 'limit'; sessionId: string | null; resetAt: Date | null }
  | { kind: 'failed'; sessionId: string | null; detail: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The reset time is read from whatever the harness gave us, which is not one shape. An epoch is
 * accepted in seconds or milliseconds, an ISO timestamp as-is, and a bare clock time is resolved
 * against `now`, rolling to tomorrow when it has already passed today.
 */
export function parseResetAt(source: string, now: Date): Date | null {
  const text = source.trim()
  if (text === '') return null

  const epoch = /^\d{9,13}$/.exec(text)
  if (epoch !== null) {
    const n = Number(text)
    const ms = text.length <= 10 ? n * 1000 : n
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const iso = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/.exec(text)
  if (iso !== null) {
    const d = new Date(iso[0].replace(' ', 'T'))
    if (!Number.isNaN(d.getTime())) return d
  }

  const clock = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text)
  if (clock === null) return null
  const rawHour = Number(clock[1])
  const minute = clock[2] === undefined ? 0 : Number(clock[2])
  const meridiem = clock[3]?.toLowerCase()
  if (Number.isNaN(rawHour) || Number.isNaN(minute) || minute > 59) return null
  let hour = rawHour
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour > 23) return null

  const candidate = new Date(now)
  candidate.setHours(hour, minute, 0, 0)
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1)
  return candidate
}

function looksLikeLimit(haystack: string): boolean {
  const lower = haystack.toLowerCase()
  return LIMIT_MARKERS.some((marker) => lower.includes(marker))
}

/**
 * `--output-format json` is the contract this reads. A run killed before it could print one leaves
 * unparseable output, so the raw text is still searched rather than assumed benign: a limit that is
 * mistaken for a crash ends the loop, which is the failure this whole module exists to prevent.
 */
export function classify(raw: string, now: Date = new Date()): Outcome {
  const parsed = ((): Record<string, unknown> | null => {
    try {
      return asRecord(JSON.parse(raw) as unknown)
    } catch {
      return null
    }
  })()

  if (parsed === null) {
    if (looksLikeLimit(raw)) {
      return { kind: 'limit', sessionId: null, resetAt: parseResetAt(resetSource(raw), now) }
    }
    return { kind: 'failed', sessionId: null, detail: raw.slice(0, 400) }
  }

  const sessionId = str(parsed.session_id) === '' ? null : str(parsed.session_id)
  const status = typeof parsed.api_error_status === 'number' ? parsed.api_error_status : 0
  const signals = [
    str(parsed.subtype),
    str(parsed.terminal_reason),
    str(parsed.stop_reason),
    str(parsed.result),
    str(parsed.error)
  ].join(' ')

  if (status === 429 || looksLikeLimit(signals)) {
    const explicit = str(parsed.resetsAt) || str(parsed.resetAt) || ''
    const source = explicit !== '' ? explicit : resetSource(signals)
    return { kind: 'limit', sessionId, resetAt: parseResetAt(source, now) }
  }

  if (parsed.is_error === true) {
    return { kind: 'failed', sessionId, detail: signals.trim().slice(0, 400) || 'run reported is_error' }
  }

  return { kind: 'done', sessionId, result: str(parsed.result) }
}

/** Narrows to the phrase that carries the time, so an unrelated number cannot be read as a clock. */
function resetSource(text: string): string {
  const phrase = /reset[s]?\s*(?:at|in)?[^.\n]{0,60}/i.exec(text)
  return phrase === null ? '' : phrase[0]
}

export const MIN_WAIT_MS = 60_000
export const MAX_WAIT_MS = 6 * 60 * 60 * 1000

/**
 * A parsed reset time is trusted only inside a sane window. A misparse that yields the distant
 * future would stall the run for as long as it takes someone to notice, and one in the past would
 * spin against a limit that has not lifted.
 */
export function waitFor(outcome: Extract<Outcome, { kind: 'limit' }>, attempt: number, now: Date = new Date()): number {
  if (outcome.resetAt !== null) {
    const delta = outcome.resetAt.getTime() - now.getTime() + 30_000
    if (delta >= MIN_WAIT_MS && delta <= MAX_WAIT_MS) return delta
    if (delta > MAX_WAIT_MS) return MAX_WAIT_MS
  }
  const backoff = MIN_WAIT_MS * 2 ** Math.max(0, attempt - 1)
  return Math.min(backoff, MAX_WAIT_MS)
}
