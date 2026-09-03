import { fetchSince } from '../github'
import { drainPending, readBindings, readCursors, writeCursors, writePending } from '../store'
import type { PendingEvent, TrackingTier, WorkItemRef } from '../types'

function short(sha: string): string {
  return sha.slice(0, 7)
}

function line(e: PendingEvent): string {
  const n = `#${e.workItem.number}`
  if (e.receipt !== null) {
    const r = e.receipt
    const parts = [`${n} ${short(r.base)} → ${short(r.head)}`]
    if (r.contractDelta.length > 0) parts.push(`contract: ${r.contractDelta.join(', ')}`)
    const failed = r.checks.filter((c) => c.conclusion === 'failure').length
    if (r.checks.length > 0)
      parts.push(failed === 0 ? `checks ${r.checks.length}/${r.checks.length} pass` : `${failed} check(s) failing`)
    if (r.blockers.length > 0) parts.push(`blockers: ${r.blockers.join('; ')}`)
    return parts.join(' · ')
  }
  return `${n} ${e.headline} — ${e.url}`
}

/**
 * Grouped by tier so the model can weight them: a bound item's receipt is about work it owns, an
 * ambient headline is peripheral. Everything here is someone else's report until re-fetched, so the
 * staleness note is not decoration.
 */
export function render(events: PendingEvent[]): string {
  if (events.length === 0) return ''
  const order: TrackingTier[] = ['bound', 'followed', 'ambient']
  const out: string[] = ['⟨dkm⟩ activity since you last looked:']
  for (const tier of order) {
    const group = events.filter((e) => e.tier === tier)
    if (group.length === 0) continue
    out.push(`  ${tier}:`)
    for (const e of group) out.push(`    ${line(e)}`)
  }
  out.push('  SHAs are as observed; re-read a file before acting if head has moved since.')
  return `${out.join('\n')}\n`
}

function trackedRepos(root: string): Map<string, { tier: TrackingTier; item: WorkItemRef }[]> {
  const map = new Map<string, { tier: TrackingTier; item: WorkItemRef }[]>()
  for (const b of readBindings(root).bindings) {
    const add = (tier: TrackingTier, item: WorkItemRef) => {
      const list = map.get(item.repoNodeId) ?? []
      list.push({ tier, item })
      map.set(item.repoNodeId, list)
    }
    if (b.bound !== null) add('bound', b.bound)
    for (const f of b.followed) add('followed', f)
  }
  return map
}

/**
 * `minIntervalMs` exists because UserPromptSubmit fires on every turn. Fetching there unthrottled
 * would put a network call on the hot path of every prompt the human types.
 */
export function ingest(root: string, minIntervalMs = 0): void {
  const cursors = readCursors(root)
  for (const [repoNodeId, tracked] of trackedRepos(root)) {
    const since = cursors.cursors[repoNodeId] ?? new Date(Date.now() - 86_400_000).toISOString()
    if (minIntervalMs > 0 && Date.now() - Date.parse(since) < minIntervalMs) continue
    const events = fetchSince(root, repoNodeId, since)
    for (const ev of events) {
      const claimed = tracked.find((t) => t.item.itemNodeId === ev.nodeId)
      writePending(root, {
        eventId: ev.nodeId,
        rootId: ev.nodeId,
        hops: 0,
        tier: claimed?.tier ?? 'ambient',
        workItem: claimed?.item ?? { repoNodeId, itemNodeId: ev.nodeId, number: ev.number, kind: ev.kind },
        observedAt: ev.updatedAt,
        headline: ev.headline,
        url: ev.url,
        receipt: null
      })
    }
    cursors.cursors[repoNodeId] = new Date().toISOString()
  }
  writeCursors(root, cursors)
}

export function drainAndRender(root: string): string {
  return render(drainPending(root))
}
