# PRD.md

**What DKM Does.** Requirements and acceptance criteria. Cites [`PRODUCT.md`](PRODUCT.md); implemented per
[`TRD.md`](TRD.md).

Contents:

1. [User Stories](#user-stories)
1. [Functional Requirements](#functional-requirements)
1. [Non-Functional Requirements](#non-functional-requirements)
1. [Out of Scope](#out-of-scope)

## User Stories

- **US-1.** As a developer with several worktrees, I bind each session to a work item once, and never hand-summarise its
  progress again.
- **US-2.** As a developer whose agent depends on someone else's work, I receive contract changes and their observed
  commit when receipt enrichment completes within the ingest budget.
- **US-3.** As a developer, my agents stop asking me questions my own policy already answers, and I can read every call
  they made in one place afterwards.
- **US-4.** As a teammate, I see one comment per work item that tells me what actually changed, with the agent's
  opinions visibly separated from the measured facts.

## Functional Requirements

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

**Ambient Excludes Raw Commits Deliberately.** A publisher's receipt captures its current head SHA. Ingest has no
repository-wide commit query.

## Optional Intake-to-Release Requirements

**Owner-Approved, 2026-09-30.** These requirements apply only when `.dkm/workflow.toml` enables the workflow. The
[workflow specification](superpowers/specs/2026-09-30-intake-release-workflow.md) defines the approved boundary.

| ID              | Requirement                                                                    | Acceptance                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WF-OPTIN**    | Missing config is disabled; malformed config is not permission                 | Legacy CLI/hooks/receipt tests pass unchanged; no new network/state/publication when off                                                                    |
| **WF-INTAKE**   | Read all comments on an explicitly bound item, including edits                 | Correct pagination/REST paths; failed reads preserve state; equal text in different IDs stays distinct                                                      |
| **WF-REVIEW**   | Track separately keyed atomic requests, decisions, rationale, phase and links  | One verdict row per request; stale comment review invalidates readiness; explicit supersession preserves history                                            |
| **WF-TRUST**    | Distinguish reported judgments/local tests from measured PR/check observations | Agent claims never certify checks, merged state, release readiness or permission                                                                            |
| **WF-PUBLISH**  | Explicitly upsert a separate human verdict comment                             | Meaningful transitions trigger publication without a new Git head; repeated identical state does not write                                                  |
| **WF-STATE**    | Guard versioned state and short atomic updates                                 | Corrupt files are not erased, stale writers fail and concurrent updates do not silently overwrite                                                           |
| **WF-RELEASE**  | Prepare exact-head versioned release plans and separately gate publication     | Disabled default, explicit approval, clean target branch, fresh successful required hosted checks and policy allow; inbound prose cannot unlock publication |
| **WF-PORTABLE** | Keep product rules/verification hints/tag conventions in thin repo config      | TolongLarp and another fixture repo use the same implementation; no TolongLarp imports or developer paths                                                   |

## Non-Functional Requirements

- **NFR-AUTH** — `decide()` remains a pure function of permission input and policy, with no store, GitHub or hook
  imports
- **NFR-NODAEMON** — Default coordination remains hook-driven. The usage-limit supervisor and optional workflow CLI
  operations are explicit foreground work; no workflow poller, model call or test execution starts on a hook path
- **NFR-BUDGET** — Hook declarations carry fixed timeouts, and ingest stops adding receipt fetches after its wall-clock
  budget is spent
- **NFR-SCHEMA** — DKM constructs receipts from the fields in `Receipt`; no hook reads a transcript or unrestricted tool
  output for publication
- **NFR-PROV** — Each receipt carries one base SHA, one head SHA and an observation timestamp. Ambient headlines do not
  carry a SHA
- **NFR-QUIET** — An unbound `Stop` and any bound `Stop` unchanged since its baseline produce no output or comment write
- **NFR-WAIT** — The supervisor derives its wait from the reported reset when usable, caps one wait at six hours and
  otherwise backs off exponentially. No path changes credentials or account

## Out of Scope

Each with the reason, so nobody relitigates it:

- **Approving Permissions on a Peer's Say-So** — the authority principle; `decide()` has no inbound-state dependency
- **Free-Form Agent Chat** — cross-session messaging already does this, and prose carries no provenance
- **Spawning or Scheduling Agents** — Agent Teams' job. The optional workflow supplies records and an operating command
  for an existing lead agent; it does not add a scheduler or model-calling orchestration engine
- **File Locking and Conflict Resolution** — worktree isolation plus Agent Teams' file-locked claiming already cover it
- **A Dashboard** — Agent View already aggregates a developer's local sessions
- **Live Mid-Turn Delivery** — v2. It needs a supervised lifecycle on the _hook_ path, which v1 deliberately has none
  of. `dkm revive` supervises a whole run from outside the harness and does not give the hooks one
- **A Learning Precedent Store** — v3. v1's authority comes from a policy the human wrote, not from inference
