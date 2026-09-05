import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fetchSince, findReceiptComment, repoNodeId } from '../github'
import { parseReceipt } from '../receipt'
import {
  dkmPath,
  drainPending,
  liveSessions,
  readBindings,
  readCursors,
  recipientKey,
  writeCursors,
  writePending
} from '../store'
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

type Recipient = {
  sessionId: string
  worktreePath: string
  bound: WorkItemRef | null
  followed: WorkItemRef[]
  ambient: boolean
}

/**
 * One entry per live session. The tier of an item still comes from the session's worktree binding:
 * the worktree that owns #81 is bound to it, and every session open in that worktree is bound to it
 * too. A session in a worktree with no binding row gets the same defaults `bindingFor` would write.
 */
function recipients(root: string): Recipient[] {
  const bindings = readBindings(root).bindings
  return liveSessions(root).map((session) => {
    const b = bindings.find((x) => x.worktreePath === session.worktreePath)
    return {
      sessionId: session.sessionId,
      worktreePath: session.worktreePath,
      bound: b?.bound ?? null,
      followed: b?.followed ?? [],
      ambient: b?.ambient ?? true
    }
  })
}

function tierFor(recipient: Recipient, nodeId: string): { tier: TrackingTier; item: WorkItemRef } | null {
  if (recipient.bound !== null && recipient.bound.itemNodeId === nodeId) {
    return { tier: 'bound', item: recipient.bound }
  }
  const followed = recipient.followed.find((f) => f.itemNodeId === nodeId)
  if (followed !== undefined) return { tier: 'followed', item: followed }
  return null
}

/**
 * An ambient-only worktree has neither a bound nor a followed item, so deriving the set from those
 * alone left it empty and `ingest()` never ran a query at all. The flag was stored and honoured by
 * `tierFor()` while being unreachable in practice. The current repository is resolved once, and
 * only when some recipient actually wants ambient.
 */
function trackedRepoIds(root: string, recipients: Recipient[]): string[] {
  const ids = new Set<string>()
  for (const r of recipients) {
    if (r.bound !== null) ids.add(r.bound.repoNodeId)
    for (const f of r.followed) ids.add(f.repoNodeId)
  }
  if (ids.size === 0 && recipients.some((r) => r.ambient)) {
    const current = repoNodeId(root)
    if (current !== null) ids.add(current)
  }
  return [...ids]
}

/**
 * Only a bound or followed item is worth a second `gh` call. Ambient is a headline and a URL by
 * definition, and without this a followed item would arrive as one too — never the contract delta
 * and head SHA that are the whole reason to follow something.
 *
 * Memoised across one ingest because the same item's receipt is identical for every recipient, and
 * queueing per worktree would otherwise multiply one fetch by the number of worktrees. Measured at
 * roughly 1s per `gh` call against a live repository, which the 15s hook timeout does not forgive
 * many times over.
 */
function receiptFor(root: string, item: WorkItemRef, cache: Map<string, Receipt | null>): Receipt | null {
  const hit = cache.get(item.itemNodeId)
  if (hit !== undefined) return hit
  const comment = findReceiptComment(root, item)
  const receipt = comment === null ? null : parseReceipt(comment.body)
  cache.set(item.itemNodeId, receipt)
  return receipt
}

/**
 * `minIntervalMs` exists because UserPromptSubmit fires on every turn. Fetching there unthrottled
 * would put a network call on the hot path of every prompt the human types.
 */
/**
 * `budgetMs` is the wall-clock allowance for network work. Past it, ingest stops fetching receipts
 * and lets the remaining events arrive as headlines: a late delta is worth more than a hook the
 * harness kills, and draining what is already pending is a local read that always happens.
 */
export function ingest(root: string, minIntervalMs = 0, budgetMs = 8000, now: () => number = Date.now): void {
  const startedAt = now()
  const receipts = new Map<string, Receipt | null>()
  const cursors = readCursors(root)
  const all = recipients(root)
  for (const repoNodeId of trackedRepoIds(root, all)) {
    const since = cursors.cursors[repoNodeId] ?? new Date(Date.now() - 86_400_000).toISOString()
    if (minIntervalMs > 0 && Date.now() - Date.parse(since) < minIntervalMs) continue
    if (now() - startedAt > budgetMs) break
    const events = fetchSince(root, since)
    for (const ev of events) {
      // The same event is queued once per recipient, each with the tier that recipient sees it at.
      for (const r of all) {
        const claimed = tierFor(r, ev.nodeId)
        if (claimed === null && !r.ambient) continue
        writePending(root, recipientKey(r.sessionId), {
          eventId: ev.nodeId,
          rootId: ev.nodeId,
          hops: 0,
          tier: claimed?.tier ?? 'ambient',
          workItem: claimed?.item ?? { repoNodeId, itemNodeId: ev.nodeId, number: ev.number, kind: ev.kind },
          observedAt: ev.updatedAt,
          headline: ev.headline,
          url: ev.url,
          receipt: claimed === null || now() - startedAt > budgetMs ? null : receiptFor(root, claimed.item, receipts)
        })
      }
    }
    cursors.cursors[repoNodeId] = new Date().toISOString()
  }
  writeCursors(root, cursors)
}

export function drainAndRender(root: string, sessionId: string): string {
  return render(drainPending(root, recipientKey(sessionId)))
}

/**
 * DKM discovers no sessions and no worktrees; a binding exists only because a human wrote one. That
 * is deliberate, but it means an unbound worktree publishes nothing and says nothing, so the user
 * finds out days later that no receipt was ever written. Conditioned on the policy file, because a
 * repository the installer never opted into must stay silent.
 */
/**
 * DKM decides only when Claude Code asks it to. A session that answers its own prompts never emits
 * `PermissionRequest`, so a committed policy is inert and nothing said so: a first-run test with
 * `--dangerously-skip-permissions` wrote no decision record at all while every other hook fired, and
 * the user reasonably read the absence of prompts as the policy working.
 *
 * `manual` and `plan` are the modes that put a question to the human. The rest are named rather than
 * classified, because which of them suppress the event is the harness's contract to state, not ours
 * to infer, and a hint that overstates is worse than one that hedges.
 */
/**
 * The harness sends `"default"` for the mode its UI labels Manual and its flag accepts as `manual`;
 * the hook payload never carries the alias. Listing only the alias warned in exactly the mode DKM
 * works in.
 */
const ASKING_MODES = new Set(['default', 'manual', 'plan'])

export function permissionModeHint(root: string, mode: string | undefined): string {
  if (mode === undefined || ASKING_MODES.has(mode)) return ''
  if (!existsSync(join(dkmPath(root), 'policy.toml'))) return ''
  return `⟨dkm⟩ this session runs in ${mode}, which answers its own permission prompts, so your .dkm/policy.toml may never be consulted. Run with --permission-mode manual to let DKM decide.\n`
}

export function unboundHint(root: string): string {
  if (!existsSync(join(dkmPath(root), 'policy.toml'))) return ''
  const binding = readBindings(root).bindings.find((b) => b.worktreePath === root)
  if (binding !== undefined && binding.bound !== null) return ''
  return '⟨dkm⟩ this worktree is not bound to a work item, so it will publish no receipts. Bind it with /dont-kacau-me:dkm-bind <number>.\n'
}
