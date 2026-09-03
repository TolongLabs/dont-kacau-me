# Don't Kacau Me — design

Status: **draft, pending review.** No implementation until this is approved.

`dont-kacau-me` (DKM) carries verified work context between the agent fleets of different developers, so that neither
human has to act as a courier.

Contents:

1. [Problem](#problem)
1. [What already exists](#what-already-exists)
1. [The authority principle](#the-authority-principle)
1. [Scope](#scope)
1. [Architecture](#architecture)
1. [The receipt](#the-receipt)
1. [Loops](#loops)
1. [Failure modes](#failure-modes)
1. [Testing](#testing)
1. [Open spikes](#open-spikes)

## Problem

A team of developers each run several Claude Code sessions. Two costs fall on the humans:

- **P1, courier duty.** An agent finishes work. Its developer must summarise that for teammates by hand, and paste
  teammates' progress back into their own agents.
- **P2, blocking decisions.** Sessions pause for the human, serialising several agents on one person's attention.

DKM v1 addresses **P1**. P2 is deliberately deferred, for the reason set out below.

## What already exists

Measured against the shipped harness on 3 Sept 2026, not assumed:

| Feature                     | Covers                                                                   | Gap for this problem                                 |
| --------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Agent View**              | Aggregates one developer's local sessions, surfaces which need input     | One person's cockpit. No cross-developer path        |
| **Agent Teams**             | Shared task list with dependencies, mailboxes, file-locked task claiming | Experimental, env-gated, one team per session        |
| **Cross-session messaging** | Message passing between a developer's own local sessions                 | Same machine, same uid. Cannot reach a teammate      |
| **Channels**                | External event ingress and permission relay                              | Transport only. No relevance, freshness or authority |
| **Worktrees**               | Native isolation for parallel sessions                                   | Isolation only. Says nothing about propagation       |

**Nothing propagates verified context between two different humans' fleets.** That gap is the whole product.

Agent Teams already implements claim/lease coordination with file locking. DKM must not rebuild it.

## The authority principle

The rule everything else is measured against:

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

This is not a stylistic preference. The harness enforces the second half: a message from a peer session is labelled as
coming from another Claude session, a peer cannot approve a permission prompt or supply consent, and a peer denied an
action cannot relay it to another session to bypass the check. In auto mode the classifier treats a relayed approval
claim as untrusted input.

Turning a peer's message into a permission grant is therefore **consent laundering**, and v1 must contain no path that
does it. A policy file the human wrote and committed in advance is legitimate authority. A model's runtime opinion,
however well reasoned and however many models concur, is not.

**This is why v1 is P1 and not P2.** A receipt publishes facts. It decides nothing, so it needs no authority at all.

## Scope

**In scope.** One updatable receipt per work item, written from measured repository state. Delivery to sessions that
have declared a dependency on that work item. Provenance: every claim carries the SHA it was observed at.

**Out of scope for v1**, each for a stated reason:

- **Answering permission prompts.** Needs delegated authority. See the authority principle
- **Free-form agent chat.** Cross-session messaging already does this, and prose is not a provenance record
- **Spawning or scheduling agents.** Agent Teams' job
- **File locking or conflict resolution.** Worktree isolation plus Agent Teams' claiming already cover it
- **A dashboard.** Agent View already aggregates local sessions
- **Uploading transcripts.** A fixed allowlisted schema is published; raw tool output and transcripts never are

## Architecture

**A hook bundle with no daemon**, shipped as a Claude Code plugin. Every moving part is a hook plus files under `.dkm/`.
There is no long-running process, therefore no process that can die silently and leave a quiet inbox looking identical
to a healthy one.

The binding constraint is the hook timeout: everything on the hot path must be a local operation. Reading `git`, reading
a JSON file and shelling to `gh` for one upsert all qualify. Calling a model does not, which is a further reason v1
resolves nothing by inference.

| Hook               | Role                                                                             |
| ------------------ | -------------------------------------------------------------------------------- |
| `Stop`             | Candidate emit point. Compute state delta, upsert the receipt if it moved        |
| `SessionStart`     | Inject pending receipts for declared dependencies. Its stdout reaches the model  |
| `UserPromptSubmit` | Same injection for an already-running session. Its stdout also reaches the model |
| `WorktreeCreate`   | Register the worktree and bind it to a work item                                 |
| `WorktreeRemove`   | Release the binding                                                              |

`Notification` is used for local telemetry only. It is fire-and-forget and can neither block nor answer, so no control
decision may depend on it.

**Sessions are isolated per worktree**, one branch each. A wrong assumption costs a discarded branch rather than a
revert, and two sessions cannot corrupt one checkout.

## The receipt

One GitHub comment per work item, edited in place, never appended to. Its defining property is that **measured fact and
agent narrative are structurally separated** and a reader can tell at a glance which is which.

Every field carries one of three kinds. **`measured`** is read from `git` or `gh` and may be acted on. **`reported`** is
asserted by the session about its own state, and may be displayed and routed but never treated as fact about the
repository. **`unverified`** is agent prose and may only ever be displayed.

| Field            | Source                                               | Kind           |
| ---------------- | ---------------------------------------------------- | -------------- |
| `work_item`      | Repository and issue/PR node ID                      | measured       |
| `base` / `head`  | `git rev-parse`                                      | measured       |
| `changed_paths`  | `git diff --name-status base..head`                  | measured       |
| `checks`         | `gh api`, carrying check-run ID and attempt          | measured       |
| `contract_delta` | Changed paths matching the configured contract globs | measured       |
| `blockers`       | Open questions the session could not resolve itself  | reported       |
| `narrative`      | The agent's prose                                    | **unverified** |
| `event_id`       | Assigned once, before any transport                  | measured       |
| `observed_at`    | Timestamp of the measurement, not of publication     | measured       |

Node IDs, never directory basenames or branch names, bind a receipt to its work item. A receipt whose `head` no longer
matches the work item's head is **stale by definition** and a consumer must re-fetch rather than act on it.

## Loops

Assume at-least-once delivery. Assign `event_id` before any transport touches the event, and never deduplicate on
message text — identical prose can represent two distinct states.

| Loop       | Trigger and path                                                        | Terminates when                           | Dedup key                                         |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| **Bind**   | `WorktreeCreate` or explicit command, resolve work item, record it      | Binding is on disk                        | repo node ID + worktree path                      |
| **Emit**   | `Stop`, compute delta, upsert comment                                   | GitHub confirms and the record reads back | repo + work item + session incarnation + head SHA |
| **Ingest** | `SessionStart` or `UserPromptSubmit` fetches since the persisted cursor | The cursor has advanced                   | comment ID + `updated_at`                         |
| **Inject** | `SessionStart` or `UserPromptSubmit`, drain pending, write to stdout    | The session has consumed it               | event ID + recipient session                      |

**The emit condition is the entire anti-noise design.** A receipt is written only when the head SHA, the blocker set, or
the check state has changed. `Stop` means "the agent finished a response", never "the work is done", so emitting on
every `Stop` would publish noise on a loop. The `stop_hook_active` flag guards re-entry.

**There is no background poller.** Ingest is a pull on the injection hooks, bounded by a persisted cursor per
repository. This keeps the no-daemon property honest: nothing runs between hook firings, so nothing can die silently and
leave a stale inbox looking healthy. The cost is that a session learns of a teammate's receipt when it next starts or
next receives a prompt, not the instant it is published. **Live mid-turn delivery is explicitly a v2 concern** and needs
either a watch process or cross-session messaging, both of which reintroduce a lifecycle to supervise.

## Failure modes

Ordered by how early they will bite.

| Failure                              | Structural mitigation                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Receipt storm**                    | Emit only on a real state delta. One mutable comment per work item, edited in place      |
| **Agent feedback loop**              | Every event carries a root ID and a hop budget. A relayed event may never be republished |
| **Speculation becomes fact**         | Typed envelopes. Only `measured` fields may be acted on; `narrative` is display-only     |
| **Stale context**                    | Every claim carries its SHA. The consumer re-fetches when head has moved                 |
| **Consent laundering**               | No code path converts a message into a permission decision. Enforced by test             |
| **Duplicate or out-of-order events** | Persistent inbox and outbox, dedup on resource version, acknowledge after persistence    |
| **Wrong repository or recipient**    | Bind on node IDs only, never on directory basename or branch name                        |
| **Poll amplification**               | No background poller. One cursored fetch per injection hook, per repository              |
| **Secret leakage**                   | Fixed allowlisted schema. Raw transcripts and tool output are never published            |

## Testing

- **Emit matrix.** No delta produces no receipt; each of head, blockers and checks changing produces exactly one
- **Idempotency.** The same state emitted twice edits one comment and never creates a second
- **Staleness.** A receipt whose head has moved is rejected by the consumer, not acted on
- **Consent boundary.** A test asserts no path exists from an inbound message to a permission decision
- **Fixture repository.** Golden receipts diffed byte for byte against recorded `git` and `gh` fixtures

## Open spikes

Each must be answered before the affected part is planned.

1. **Does `Stop` exit 2 hand the model a usable reason to continue?** Determines whether any of P2b is reachable later.
   One hour
1. **Can a hook reliably resolve head SHA and work-item binding inside a worktree**, including a detached head. One hour
1. **Hook-time fetch latency.** Whether a cursored `gh` fetch fits inside the injection hooks' timeout at realistic
   session counts, and what happens when it does not. One hour

## Prior art

- **Open Orchestrator** — worktree isolation and a prioritised needs-you cockpit. A local process manager, not a
  cross-developer provenance system
- **Gas Town** — persistent mailboxes, health patrol, work routing. Requires adopting a managed swarm
- **PagerDuty** — dedup keys, suppression, acknowledgement, heartbeat failure detection. Routes interruptions to humans
  rather than removing them
- **Kubernetes controllers** — reconciliation and desired versus observed state. Receives desired state explicitly,
  where DKM must establish who was authorised to declare it
