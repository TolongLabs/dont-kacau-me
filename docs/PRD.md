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
- **US-2.** As a developer whose agent depends on someone else's work, I receive their contract changes in my agent's
  context, bound to the commit they were observed at, without asking anyone.
- **US-3.** As a developer, my agents stop asking me questions my own policy already answers, and I can read every call
  they made in one place afterwards.
- **US-4.** As a teammate, I see one comment per work item that tells me what actually changed, with the agent's
  opinions visibly separated from the measured facts.

## Functional requirements

| ID             | Requirement                                                                                                      | Acceptance                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **FR-BIND**    | A session binds to a work item, explicitly or by resolving its branch to an open PR                              | Binding survives a restart; a wrong basename or branch name never resolves a binding |
| **FR-EMIT**    | On `Stop`, if and only if head SHA, blocker set or check state changed, upsert the work item's receipt           | No delta produces no write; the same delta twice edits one comment                   |
| **FR-TIER**    | Track at three tiers: bound, followed, ambient. Deliver at the finest tier that claims a signal                  | A signal claimed by `bound` never also arrives as `ambient`                          |
| **FR-INGEST**  | On `SessionStart` and `UserPromptSubmit`, fetch since the persisted cursor and inject pending items into context | Cursor advances; a replayed fetch injects nothing new                                |
| **FR-DECIDE**  | On `PermissionRequest`, evaluate the installer's policy and return `allow`, `deny` or `ask`                      | Every branch of the rule table is exercised by a test                                |
| **FR-LOG**     | Every autonomous decision appends a record naming the rule, the inputs, and how to reverse it                    | A decision with no matching log entry fails the test suite                           |
| **FR-AMBIENT** | Ambient covers new issues, new PRs, @mentions and base-branch CI failures. Headline and URL only                 | Bodies are never fetched or stored; raw commits are not an ambient signal            |

**Ambient excludes raw commits deliberately.** A commit reaches the user as a head SHA change on a bound or followed
item, which is the only context where it is actionable.

## Non-functional requirements

- **NFR-AUTH** — No code path exists from an inbound message to a permission decision. Enforced by a test, not by review
- **NFR-NODAEMON** — No process runs between hook firings. Ingest is a cursored pull, never a background poller
- **NFR-BUDGET** — Every hook completes within its timeout on a repository of at least 5,000 commits
- **NFR-SCHEMA** — Published receipts carry a fixed allowlisted schema. Raw transcripts and tool output are never
  published
- **NFR-PROV** — Every published claim carries the SHA it was observed at. A consumer re-fetches when head has moved
- **NFR-QUIET** — A session that changed nothing produces no network write and no output

## Out of scope

Each with the reason, so nobody relitigates it:

- **Approving permissions on a peer's say-so** — the authority principle, and the harness blocks it regardless
- **Free-form agent chat** — cross-session messaging already does this, and prose carries no provenance
- **Spawning or scheduling agents** — Agent Teams' job
- **File locking and conflict resolution** — worktree isolation plus Agent Teams' file-locked claiming already cover it
- **A dashboard** — Agent View already aggregates a developer's local sessions
- **Live mid-turn delivery** — v2. It needs a supervised lifecycle, which v1 deliberately has none of
- **A learning precedent store** — v3. v1's authority comes from a policy the human wrote, not from inference
