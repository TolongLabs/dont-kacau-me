# TRD.md

**How DKM is built.** Canonical over [`AGENTS.md`](../AGENTS.md) on technical detail. Implements [`PRD.md`](PRD.md).

Contents:

1. [Architecture](#architecture)
1. [Storage layout](#storage-layout)
1. [Hook contracts](#hook-contracts)
1. [The receipt](#the-receipt)
1. [The decision engine](#the-decision-engine)
1. [Loops and dedup keys](#loops-and-dedup-keys)
1. [Failure modes](#failure-modes)
1. [Testing](#testing)
1. [Open spikes](#open-spikes)

## Architecture

**A hook bundle with no daemon**, distributed as a Claude Code plugin. Every moving part is a hook process that starts,
does one local operation, writes to `.dkm/`, and exits.

The binding constraint is the **hook timeout**. Everything on the hot path must be a local `git` read, a JSON file read
or write, or at most one `gh` call. Nothing on the hot path may call a model — which is also why the decision engine
resolves by rule table rather than by inference.

Sessions are isolated **one git worktree each**, one branch each. A wrong assumption costs a discarded branch rather
than a revert, and two sessions cannot corrupt one checkout.

```
worktree A ──┐                      ┌── receipt (one GitHub comment per work item)
             ├── hooks ── .dkm/ ────┤
worktree B ──┘                      └── decisions.jsonl (local audit log)
```

## Storage layout

All state is under `.dkm/` at the repository root, git-ignored. It is per-checkout and disposable; deleting it costs
only the cursors.

| Path                     | Holds                                                          | Format         |
| ------------------------ | -------------------------------------------------------------- | -------------- |
| `.dkm/policy.toml`       | The installer's decision policy. **Committed**, not ignored    | TOML           |
| `.dkm/bindings.json`     | Worktree path to work-item node ID, and followed item node IDs | JSON           |
| `.dkm/cursor.json`       | Per-repository ingest cursor                                   | JSON           |
| `.dkm/pending/<id>.json` | Fetched-but-not-yet-injected items                             | JSON per event |
| `.dkm/decisions.jsonl`   | Append-only record of every autonomous decision                | JSONL          |
| `.dkm/last-emit.json`    | Last emitted state per work item, for delta detection          | JSON           |

`.dkm/policy.toml` is the one file that is committed, because it is the human grant that makes autonomy legitimate.
Everything else is machine state.

## Hook contracts

Every hook receives the standard payload on stdin, including `session_id`, `cwd`, `permission_mode` and
`hook_event_name`.

| Hook                | Reads                 | Effect                                                             |
| ------------------- | --------------------- | ------------------------------------------------------------------ |
| `Stop`              | `stop_hook_active`    | Compute delta; upsert the receipt only if it moved                 |
| `SessionStart`      | `cwd`                 | Drain `.dkm/pending/`, write to stdout so it reaches the model     |
| `UserPromptSubmit`  | `cwd`                 | Fetch since cursor, drain pending, write to stdout                 |
| `PermissionRequest` | tool name, tool input | Answer `allow` or `deny`, or emit nothing to leave it to the human |

**`PermissionRequest` output.** Exit code 2 is ignored by this event; the decision must be in the payload, and the
payload is schema-validated. A shape the harness does not recognise is treated as a **hook failure, which denies the
tool** — so a malformed `allow` is not a no-op, it is a deny the installer never asked for.

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }
```

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "deny", "message": "why" } } }
```

**There is no wire form for `ask`.** The schema admits only `allow` and `deny`; emitting no decision at all (`{}`) is
what hands the prompt back to the human. That makes `{}` the only safe output from a handler that has failed, and the
`deny` message is shown to the model, so it should name the rule that produced it.

**`WorktreeCreate` and `WorktreeRemove` are provider hooks, not notifications.** `WorktreeCreate` is expected to create
the worktree and echo its path to stdout; a handler that echoes nothing aborts worktree creation with
`hook succeeded but returned no worktree path`. `WorktreeRemove` is expected to remove it, and one that does not leaves
the worktree on disk. Its payload carries `name`, never a worktree path or a branch. DKM therefore registers neither,
and binding runs through `/dkm-bind`, which resolves the work item by number.

**`SessionStart` and `UserPromptSubmit` output** is plain text on stdout, which the harness adds to the model's context.
This is the only injection path available without a supervised process.

**`Stop` re-entrancy.** The `stop_hook_active` flag is set when a `Stop` hook is already in flight. The handler must
return immediately when it is set, or a hook that continues the conversation will loop.

**`Stop` can also speak to the model**, through `hookSpecificOutput.additionalContext`. The conversation continues and
the string is delivered verbatim, so a `Stop` hook can hand the agent a reason to keep going without exit 2. DKM v1 does
not use this; it is what makes P2b reachable in v2.

## The receipt

One GitHub comment per work item, **edited in place, never appended to**. Its defining property is that measured fact
and agent narrative are structurally separated.

Every field carries one of three kinds:

- **`measured`** — read from `git` or `gh`. May be acted on
- **`reported`** — asserted by the session about its own state. May be displayed and routed, never treated as fact about
  the repository
- **`unverified`** — agent prose. May only ever be displayed

| Field            | Source                                               | Kind           |
| ---------------- | ---------------------------------------------------- | -------------- |
| `work_item`      | Repository and issue/PR node ID                      | measured       |
| `base` / `head`  | `git rev-parse`                                      | measured       |
| `changed_paths`  | `git diff --name-status base..head`                  | measured       |
| `checks`         | `gh api`, carrying check-run ID and attempt          | measured       |
| `contract_delta` | Changed paths matching the configured contract globs | measured       |
| `decisions`      | Count and summary from `decisions.jsonl` this turn   | measured       |
| `blockers`       | Open questions the session could not resolve         | reported       |
| `narrative`      | The agent's prose                                    | **unverified** |
| `event_id`       | Assigned once, before any transport                  | measured       |
| `observed_at`    | Timestamp of measurement, not of publication         | measured       |

Node IDs bind a receipt to its work item — never a directory basename or a branch name. A receipt whose `head` no longer
matches the work item's head is **stale by definition**, and a consumer must re-fetch rather than act on it.

## The decision engine

`PermissionRequest` fires exactly when the harness would otherwise interrupt the human. DKM answers it from
`.dkm/policy.toml`, which the installer wrote and committed.

**Evaluation order.** First match wins; the default is always `ask`.

1. **Blast-radius deny rules.** Mechanically checkable, no judgement
1. **Explicit policy allow rules.** Paths, tools and commands the installer granted in advance
1. **Default `ask`.** Anything unmatched reaches the human, exactly as today

**The blast-radius table is the safety property**, and it is deliberately mechanical rather than a model's assessment of
importance. Agents are systematically poor at self-assessing risk; a rule table cannot talk itself into optimism.

| Trip                                                               | Result  |
| ------------------------------------------------------------------ | ------- |
| Deletes data, drops a column, or writes a migration                | `ask`   |
| Egress: posts, publishes, deploys, sends, or opens a network write | `ask`   |
| Spends money                                                       | `ask`   |
| Touches a lockfile, an exported API surface, or `.env`             | `ask`   |
| Touches anything under `.dkm/`, the grant itself                   | `ask`   |
| Writes outside the session's own worktree                          | `deny`  |
| Matches an explicit policy allow rule and trips nothing above      | `allow` |

**Every autonomous decision appends to `.dkm/decisions.jsonl`** before the decision is returned, never after:

```json
{
  "ts": "2026-09-03T15:04:05Z",
  "session": "abc123",
  "tool": "Bash",
  "summary": "bun test",
  "decision": "allow",
  "rule": "policy.allow.commands[3]",
  "reverse": "n/a, read-only"
}
```

A decision with no log entry is a bug, and the test suite fails on it. The count and summary surface in the receipt's
`decisions` field, so the human's audit is reading a handful of lines rather than re-litigating the work.

**There is no path from an inbound message to a decision.** The engine reads `policy.toml`, the tool payload and the
repository. It never reads `.dkm/pending/`. `NFR-AUTH` asserts this by test.

## Loops and dedup keys

Assume at-least-once delivery. Assign `event_id` before any transport touches an event. **Never deduplicate on message
text** — identical prose can represent two distinct states.

| Loop       | Trigger and path                                         | Terminates when                   | Dedup key                                         |
| ---------- | -------------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| **Bind**   | `/dkm-bind <number>`, resolve, record                    | Binding is on disk                | repo node ID + worktree path                      |
| **Emit**   | `Stop`, compute delta, upsert comment                    | GitHub confirms and it reads back | repo + work item + session incarnation + head SHA |
| **Ingest** | `SessionStart` or `UserPromptSubmit`, fetch since cursor | The cursor has advanced           | comment ID + `updated_at`                         |
| **Inject** | Drain `.dkm/pending/`, write to stdout                   | The session has consumed it       | event ID + recipient session                      |
| **Decide** | `PermissionRequest`, evaluate policy, log, return        | A decision is returned            | session + tool-use ID                             |

**The emit condition is the entire anti-noise design.** A receipt is written only when head SHA, blocker set or check
state changed. `Stop` means "the agent finished a response", never "the work is done"; emitting on every `Stop` would
publish noise on a loop.

**There is no background poller.** Ingest is a cursored pull on the injection hooks. This keeps the no-daemon property
honest: nothing runs between firings, so nothing can die silently and leave a stale inbox looking healthy. The cost is
that a session learns of a receipt when it next starts or next receives a prompt — **live mid-turn delivery is v2**, and
needs a supervised lifecycle v1 deliberately does not have.

## Failure modes

- **Receipt storm** — Emit only on a real state delta. One mutable comment per work item, edited in place
- **Agent feedback loop** — Every event carries a root ID and a hop budget. A relayed event is never republished
- **Speculation becomes fact** — Typed kinds. Only `measured` may be acted on; `narrative` is display-only
- **Stale context** — Every claim carries its SHA. The consumer re-fetches when head has moved
- **Consent laundering** — The engine never reads inbound state. Asserted by `NFR-AUTH`
- **Runaway autonomy** — Default `ask`, deny rules evaluated first, and every call logged before it returns
- **Duplicate or out-of-order events** — Dedup on resource version. Acknowledge only after persistence
- **Wrong repository or recipient** — Bind on node IDs only
- **Secret leakage** — Fixed allowlisted schema. Raw transcripts and tool output are never published
- **Hook timeout** — Every handler fails open and exits 0. A broken hook must never wedge a session
- **Fail-open that is really fail-closed** — A malformed decision is read as a hook failure and denies the tool.
  `PermissionRequest` must emit `{}`, never a best-effort decision, when it cannot answer

## Testing

- **Emit matrix** — no delta produces no receipt; head, blockers and checks each produce exactly one
- **Idempotency** — the same state emitted twice edits one comment, never creates a second
- **Staleness** — a receipt whose head moved is rejected by the consumer
- **Decision table** — every row of the blast-radius table, plus the `ask` default
- **Wire contract** — the exact bytes each hook writes, asserted against the harness's schema rather than ours
- **Consent boundary** — a test asserts no reachable path from `.dkm/pending/` into the decision engine
- **Log completeness** — every decision returned has a matching `decisions.jsonl` entry
- **Fixture repository** — golden receipts diffed against recorded `git` and `gh` fixtures

## Open spikes

Each blocks the part it names, and nothing else.

1. ~~**Does `Stop` exit 2 hand the model a usable reason to continue?**~~ **Answered: yes, and exit 2 is not needed.**
   `hookSpecificOutput.additionalContext` on `Stop` reaches the model verbatim and the turn continues. P2b is reachable
1. ~~**Can a hook resolve head SHA and work-item binding inside a worktree**~~ **Answered: yes.** Verified in a live
   session in a linked worktree; state resolves through `--git-common-dir`, so every worktree shares one `.dkm/`. The
   detached-head case is still unexercised
1. **Does a cursored `gh` fetch fit inside the injection hooks' timeout**, and what happens when it does not
