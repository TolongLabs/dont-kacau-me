import { fetchSince, findReceiptComment } from '../github'
import { parseReceipt } from '../receipt'
import { drainPending, readBindings, readCursors, recipientKey, writeCursors, writePending } from '../store'
import type { PendingEvent, Receipt, TrackingTier, WorkItemRef } from '../types'

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

type Recipient = { worktreePath: string; bound: WorkItemRef | null; followed: WorkItemRef[]; ambient: boolean }

/**
 * One entry per worktree, never a flattened map. The tier of an item depends on who is asking:
 * the worktree that owns #81 is bound to it, and a worktree that declared a dependency on it is
 * following it. Resolving that globally told a following session it was bound, because the answer
 * came from whichever binding happened to be first in the file.
 */
function recipients(root: string): Recipient[] {
  return readBindings(root).bindings.map((b) => ({
    worktreePath: b.worktreePath,
    bound: b.bound,
    followed: b.followed,
    ambient: b.ambient
  }))
}

function tierFor(recipient: Recipient, nodeId: string): { tier: TrackingTier; item: WorkItemRef } | null {
  if (recipient.bound !== null && recipient.bound.itemNodeId === nodeId) {
    return { tier: 'bound', item: recipient.bound }
  }
  const followed = recipient.followed.find((f) => f.itemNodeId === nodeId)
  if (followed !== undefined) return { tier: 'followed', item: followed }
  return null
}

function trackedRepoIds(recipients: Recipient[]): string[] {
  const ids = new Set<string>()
  for (const r of recipients) {
    if (r.bound !== null) ids.add(r.bound.repoNodeId)
    for (const f of r.followed) ids.add(f.repoNodeId)
  }
  return [...ids]
}

/**
 * Only a bound or followed item is worth a second `gh` call. Ambient is a headline and a URL by
 * definition, and without this a followed item would arrive as one too — never the contract delta
 * and head SHA that are the whole reason to follow something.
 */
function receiptFor(root: string, item: WorkItemRef): Receipt | null {
  const comment = findReceiptComment(root, item)
  if (comment === null) return null
  return parseReceipt(comment.body)
}

/**
 * `minIntervalMs` exists because UserPromptSubmit fires on every turn. Fetching there unthrottled
 * would put a network call on the hot path of every prompt the human types.
 */
export function ingest(root: string, minIntervalMs = 0): void {
  const cursors = readCursors(root)
  const all = recipients(root)
  for (const repoNodeId of trackedRepoIds(all)) {
    const since = cursors.cursors[repoNodeId] ?? new Date(Date.now() - 86_400_000).toISOString()
    if (minIntervalMs > 0 && Date.now() - Date.parse(since) < minIntervalMs) continue
    const events = fetchSince(root, since)
    for (const ev of events) {
      // The same event is queued once per recipient, each with the tier that recipient sees it at.
      for (const r of all) {
        const claimed = tierFor(r, ev.nodeId)
        if (claimed === null && !r.ambient) continue
        writePending(root, recipientKey(r.worktreePath), {
          eventId: ev.nodeId,
          rootId: ev.nodeId,
          hops: 0,
          tier: claimed?.tier ?? 'ambient',
          workItem: claimed?.item ?? { repoNodeId, itemNodeId: ev.nodeId, number: ev.number, kind: ev.kind },
          observedAt: ev.updatedAt,
          headline: ev.headline,
          url: ev.url,
          receipt: claimed === null ? null : receiptFor(root, claimed.item)
        })
      }
    }
    cursors.cursors[repoNodeId] = new Date().toISOString()
  }
  writeCursors(root, cursors)
}

export function drainAndRender(root: string): string {
  return render(drainPending(root, recipientKey(root)))
}
