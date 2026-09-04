# PRD.md

**What DKM does.** Requirements and acceptance criteria. Cites [`PRODUCT.md`](PRODUCT.md); implemented per
[`TRD.md`](TRD.md).

Contents:

1. [User stories](#user-stories)
1. [Functional requirements](#functional-requirements)
1. [Non-functional requirements](#non-functional-requirements)
1. [Out of scope](#out-of-scope)

## User stories

- **US-1.** As a developer with several worktrees, I bind each session to a work item once, and never hand-summarise its
  progress again.
- **US-2.** As a developer whose agent depends on someone else's work, I receive contract changes and their observed
  commit when receipt enrichment completes within the ingest budget.
- **US-3.** As a developer, my agents stop asking me questions my own policy already answers, and I can read every call
  they made in one place afterwards.
- **US-4.** As a teammate, I see one comment per work item that tells me what actually changed, with the agent's
  opinions visibly separated from the measured facts.

## Functional requirements

| ID             | Requirement                                                                                                           | Acceptance                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **FR-BIND**    | Bind the current worktree to an explicit GitHub issue or PR number                                                    | Resolve the item and repository node IDs before writing `bindings.json`                      |
| **FR-EMIT**    | On the first bound `Stop`, publish a baseline; later, upsert only when head, blockers or check fingerprint changes    | Two consecutive stops with the same tracked state make one comment write                     |
| **FR-TIER**    | Label each recipient's event as bound, followed or ambient, using the finest relationship that applies                | A bound item is not also queued as followed or ambient for the same worktree                 |
| **FR-INGEST**  | On `SessionStart` and `UserPromptSubmit`, fetch updated issues and PRs, queue per recipient, then drain that worktree | A valid queued file is deleted on drain; an undrained update for the same item overwrites it |
| **FR-DECIDE**  | On `PermissionRequest`, evaluate the policy and emit `allow`, `deny` or `{}` for the human path                       | Blast-radius checks precede ordered allow rules, and unmatched input produces `{}`           |
| **FR-LOG**     | Before emitting, append the tool, input summary, decision and rule, plus the current `reverse` placeholder            | Successful evaluation writes one `DecisionRecord` before `emit()`                            |
| **FR-AMBIENT** | Treat updated issues and PRs not claimed as bound or followed as ambient                                              | Narrow GitHub results to `AmbientEvent` before constructing `PendingEvent`                   |
| **FR-REVIVE**  | Treat a recognised usage limit as a pause, then resume the reported session after the computed wait                   | Never replay the original prompt after a session ID exists; stop on a genuine error          |

**Ambient excludes raw commits deliberately.** A publisher's receipt captures its current head SHA. Ingest has no
repository-wide commit query.

## Non-functional requirements

- **NFR-AUTH** — `decide()` remains a pure function of permission input and policy, with no store, GitHub or hook
  imports
- **NFR-NODAEMON** — Receipt, ingest and decision work runs only on hooks. The usage-limit supervisor is opt-in and
  foreground
- **NFR-BUDGET** — Hook declarations carry fixed timeouts, and ingest stops adding receipt fetches after its wall-clock
  budget is spent
- **NFR-SCHEMA** — DKM constructs receipts from the fields in `Receipt`; no hook reads a transcript or unrestricted tool
  output for publication
- **NFR-PROV** — Each receipt carries one base SHA, one head SHA and an observation timestamp. Ambient headlines do not
  carry a SHA
- **NFR-QUIET** — An unbound `Stop` and any bound `Stop` unchanged since its baseline produce no output or comment write
- **NFR-WAIT** — The supervisor derives its wait from the reported reset when usable, caps one wait at six hours and
  otherwise backs off exponentially. No path changes credentials or account

## Out of scope

Each with the reason, so nobody relitigates it:

- **Approving permissions on a peer's say-so** — the authority principle; `decide()` has no inbound-state dependency
- **Free-form agent chat** — cross-session messaging already does this, and prose carries no provenance
- **Spawning or scheduling agents** — Agent Teams' job
- **File locking and conflict resolution** — worktree isolation plus Agent Teams' file-locked claiming already cover it
- **A dashboard** — Agent View already aggregates a developer's local sessions
- **Live mid-turn delivery** — v2. It needs a supervised lifecycle on the _hook_ path, which v1 deliberately has none
  of. `dkm revive` supervises a whole run from outside the harness and does not give the hooks one
- **A learning precedent store** — v3. v1's authority comes from a policy the human wrote, not from inference
