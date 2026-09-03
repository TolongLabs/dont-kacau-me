# TRD.md

**How DKM is built.** Canonical over [`AGENTS.md`](../AGENTS.md) on technical detail. Implements [`PRD.md`](PRD.md).

This is the implementation-level reference for developers building against DKM or changing its source. It is deeper than
the narrative in [`README.md`](README.md).

Contents:

1. [Architecture](#architecture)
1. [Storage layout](#storage-layout)
1. [Hook contracts](#hook-contracts)
1. [The receipt](#the-receipt)
1. [Tracking tiers](#tracking-tiers)
1. [The decision engine](#the-decision-engine)
1. [Surviving a usage limit](#surviving-a-usage-limit)
1. [Loops and dedup keys](#loops-and-dedup-keys)
1. [Failure modes](#failure-modes)
1. [Testing](#testing)
1. [Open spikes](#open-spikes)

## Architecture

**A hook bundle with no daemon.** DKM is distributed as a Claude Code plugin. The harness reads the manifest from
`.claude-plugin/plugin.json`, the hook declarations from `hooks/hooks.json` and the slash-command frontmatter from
`commands/*.md`. `hooks/hooks.json` resolves each entrypoint against `${CLAUDE_PLUGIN_ROOT}`.

Every moving part is a hook process that starts, does one local operation, writes to `.dkm/` and exits. Nothing runs
between firings. `NFR-NODAEMON` requires this to be true. The registered handlers are:

- `PermissionRequest`: `src/hooks/permission-request.ts`, 5s timeout.
- `Stop`: `src/hooks/stop.ts`, 20s timeout.
- `SessionStart`: `src/hooks/session-start.ts`, 15s timeout, matcher `startup|resume|clear`.
- `UserPromptSubmit`: `src/hooks/user-prompt-submit.ts`, 15s timeout.

The binding constraint is the **hook timeout**. Everything on the hot path must be a local `git` read, a JSON file read
or write, or at most one `gh` call. The slowest operation permitted is a single `gh` call in `Stop` or
`SessionStart`/`UserPromptSubmit`.

Nothing on the hot path may call a model — which is also why the decision engine resolves by the rule table in
`src/decide.ts` rather than by inference. `NFR-BUDGET` requires every hook to complete on a repository of at least 5,000
commits.

Sessions are isolated **one git worktree each**, one branch each. A wrong assumption costs a discarded branch rather
than a revert, and two sessions cannot corrupt one checkout.

`src/store.ts` resolves the shared `.dkm/` directory to the main worktree using `git rev-parse --git-common-dir`; the
parent of the common `.git` directory is the main worktree root. For a plain checkout this is the repository root
itself. `src/hooks/runtime.ts` resolves the worktree root with `git rev-parse --show-toplevel`.

```
worktree A ──┐                      ┌── receipt (one GitHub comment per work item)
             ├── hooks ── .dkm/ ────┤
worktree B ──┘                      └── decisions.jsonl (local audit log)
```

## Storage layout

All state is under `.dkm/` at the main worktree root, git-ignored. It is per-checkout and disposable; deleting it costs
only the cursors. The `.gitignore` entry is `.dkm/*` with `!.dkm/policy.toml`.

| Path                                 | Holds                                                          | Format         |
| ------------------------------------ | -------------------------------------------------------------- | -------------- |
| `.dkm/policy.toml`                   | The installer's decision policy. **Committed**, not ignored    | TOML           |
| `.dkm/bindings.json`                 | Worktree path to work-item node ID, and followed item node IDs | JSON           |
| `.dkm/cursor.json`                   | Per-repository ingest cursor                                   | JSON           |
| `.dkm/pending/<recipient>/<id>.json` | Fetched-but-not-yet-injected items, one queue per worktree     | JSON per event |
| `.dkm/decisions.jsonl`               | Append-only record of every autonomous decision                | JSONL          |
| `.dkm/last-emit.json`                | Last emitted state per work item, for delta detection          | JSON           |
| `.dkm/report/<session>.json`         | Session-authored narrative and blockers for the next receipt   | JSON           |
| `.dkm/revivals.jsonl`                | Append-only record of every usage-limit pause and resume       | JSONL          |
| `.dkm/last-session.json`             | The session that ended last, and the reason the harness gave   | JSON           |

`.dkm/policy.toml` is the one file that is committed, because it is the human grant that makes autonomy legitimate.
Everything else is machine state.

`src/store.ts` reads and writes these files. Every JSON file carries a `version` field and a runtime guard; an unknown
shape falls back to an empty default. `decisions.jsonl` is appended to, never rewritten. All writes except the JSONL
append are atomic: written to a `randomUUID().tmp` file in the same directory and renamed into place.

## Hook contracts

Every hook receives the standard payload on stdin, including `session_id`, `cwd`, `permission_mode` and
`hook_event_name`. The `HookPayload` type in `src/hooks/runtime.ts` also carries `stop_hook_active`, `tool_name` and
`tool_input` where the event provides them.

| Hook                | Reads                 | Effect                                                             |
| ------------------- | --------------------- | ------------------------------------------------------------------ |
| `Stop`              | `stop_hook_active`    | Compute delta; upsert the receipt only if it moved                 |
| `SessionStart`      | `cwd`                 | Drain `.dkm/pending/`, write to stdout so it reaches the model     |
| `UserPromptSubmit`  | `cwd`                 | Fetch since cursor, drain pending, write to stdout                 |
| `PermissionRequest` | tool name, tool input | Answer `allow` or `deny`, or emit nothing to leave it to the human |
| `SessionEnd`        | `reason`              | Record the session id and the reason, so a run can be resumed      |

The registered timeouts are 20s for `Stop`, 15s for `SessionStart` and `UserPromptSubmit`, 10s for `SessionEnd` and 5s
for `PermissionRequest`.

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
`deny` message is shown to the model, so it should name the rule that produced it. `src/hooks/permission-request.ts`
loads `src/policy.ts`, calls `src/decide.ts`, appends the record to `decisions.jsonl` and then emits.

**`WorktreeCreate` and `WorktreeRemove` are provider hooks, not notifications.** `WorktreeCreate` is expected to create
the worktree and echo its path to stdout; a handler that echoes nothing aborts worktree creation with
`hook succeeded but returned no worktree path`.

`WorktreeRemove` is expected to remove it, and one that does not leaves the worktree on disk. Its payload carries
`name`, never a worktree path or a branch. DKM therefore registers neither, and binding runs through `/dkm-bind`, which
resolves the work item by number.

**`SessionStart` and `UserPromptSubmit` output** is plain text on stdout, which the harness adds to the model's context.
This is the only injection path available without a supervised process.

The text is produced by `src/hooks/inject.ts`: events are grouped by tier (`bound`, `followed`, `ambient`) and rendered
by `line()`. For a receipt the line looks like:

```text
#81 a1b2c3d → e5f6g7h · contract: src/types.ts · 2 check(s) failing · blockers: retry policy
```

For ambient events without a receipt it looks like:

```text
#82 Headline of the new issue — https://github.com/owner/repo/issues/82
```

The output ends with a staleness note.

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

The receipt is rendered by `src/receipt.ts`. The human-readable part starts with `<!-- dkm:receipt v1 -->` and ends with
`<!-- /dkm:receipt -->`.

It contains:

- a summary table for `base`, `head` and `observed_at`.
- the list of changed paths.
- a table of check results.
- the contract delta.
- the decision summary.
- a block-quoted **Unverified agent narrative** section.
- a fenced JSON block with the full `Receipt` object.

`parseReceipt()` reads the first fenced JSON block back from the comment body.

Each field is computed as follows:

- `work_item` is the `WorkItemRef` from `bindings.json`: `repoNodeId`, `itemNodeId`, `number` and `kind`.
- `base` is `git merge-base HEAD origin/HEAD` with fallbacks to `origin/main` and `origin/master`.
- `head` is `git rev-parse HEAD`.
- `changed_paths` is the parsed output of `git diff --name-status base..head`, producing `ChangedPath` records with
  status `A`, `M`, `D`, `R` or `C`.
- `checks` comes from `gh api repos/{owner}/{repo}/commits/<head>/check-runs`, producing `CheckResult` records with
  `name`, `checkRunId`, `attempt` and a `conclusion` in
  `success | failure | neutral | cancelled | timed_out | skipped | pending`.
- `contract_delta` is the subset of `changed_paths` whose path matches a `contractGlobs` pattern from
  `.dkm/policy.toml`. The glob engine is in `src/git.ts`.
- `decisions` is a `DecisionSummary` counted from `decisions.jsonl` for the current `session_id`.
- `blockers` and `narrative` are read from `.dkm/report/<session_id>.json` by `src/hooks/report.ts` and cleared after
  the receipt is emitted.
- `event_id` is `crypto.randomUUID()`.
- `observed_at` is the ISO timestamp of measurement.

Node IDs bind a receipt to its work item — never a directory basename or a branch name. A receipt whose `head` no longer
matches the work item's head is **stale by definition**, and a consumer must re-fetch rather than act on it.

## Tracking tiers

A signal is delivered only at the finest tier that claims it, so nothing arrives twice. The tier is resolved from
`bindings.json` by `src/hooks/inject.ts trackedRepos()`, and ambient is the default for any event in a tracked
repository that is neither the bound nor a followed item.

- **Bound** — the work item this worktree owns. `src/hooks/stop.ts` renders the receipt and
  `src/github.ts upsertReceiptComment()` writes it to the item's comment. `src/hooks/inject.ts receiptFor()` fetches it
  back and `line()` injects a short summary
- **Followed** — work items this session declared a dependency on. `receiptFor()` fetches the receipt comment,
  `parseReceipt()` extracts the `Receipt`, and `line()` renders the contract delta, head SHA, blockers and a checks
  summary. With no receipt found it falls back to headline and URL
- **Ambient** — repository-wide activity. `src/github.ts fetchSince()` lists issues and PRs updated since the cursor,
  and `src/hooks/inject.ts` stores only `headline` and `url`, never the body. Raw commits are not an ambient signal

**Delivery is per recipient.** `ingest()` queues one copy of an event per worktree, under `.dkm/pending/<recipient>/`,
where the recipient key is the first 16 hex characters of the SHA-256 of the worktree path. The tier is resolved
separately for each recipient by `tierFor()`, so the worktree that owns an item is told `bound` and one that follows it
is told `followed`. `drainAndRender()` reads only its own directory.

A single shared queue could represent only one of those answers, and whichever session drained first consumed the event
for everyone.

## The decision engine

`PermissionRequest` fires exactly when the harness would otherwise interrupt the human. DKM answers it from
`.dkm/policy.toml`, which the installer wrote and committed.

### Policy file schema

`src/policy.ts` parses `.dkm/policy.toml` line by line. It does not use a TOML library. The parser recognises quoted
strings, inline comments (`#` outside quotes) and array literals. The supported fields are:

- `version` — integer; currently `1`. Stored but not used to gate behaviour.
- `contractGlobs` — array of path globs. Passed to `src/git.ts contractDelta()` to compute the receipt's
  `contract_delta`.
- `[[allow]]` — repeated table. Each rule has:
  - `tool` — the tool name from the payload, e.g. `Bash` or `Edit`.
  - `match` — optional substring that must appear in the command, `file_path`, `path` or `url` field.
  - `paths` — optional array of path globs. Each candidate path is resolved against `cwd` and matched relatively to the
    worktree root.

If `rtk` is present, the `match` string is compared against the rewritten command, so `match` rules should be
substring-safe.

### Evaluation order

First match wins; the default is always `ask`.

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

`src/decide.ts` evaluates the trips in this order: `outside-worktree`, `data-loss`, `money`, `egress`, `surface`. The
table above groups them by result, but `outside-worktree` is checked first because it is the only `deny` rule and must
prevent an allow rule from authorizing an escape. The implementation details are:

- `outside-worktree`: every string and path candidate in `tool_input` is resolved against `cwd` and checked against the
  worktree root. Any candidate outside the worktree produces `deny`.
- `data-loss`: matches `rm -rf` style commands, destructive SQL (`drop table`, `drop column`, `truncate`, `delete from`)
  or a path containing `migrations` or `drizzle`.
- `money`: matches `npm publish`, `bun publish`, `vercel deploy` or `gh release create`.
- `egress`: matches `curl`, `wget`, `git push`, `bun/npm run deploy`, `gh pr/issue create/comment`,
  `gh api ... -X POST/PATCH/PUT/DELETE` or any command containing `deploy` except `vercel deploy`.
- `surface`: matches any candidate whose basename is in `bun.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`,
  `package.json`, `.env` or `.env.*`, or any path under `.dkm/`.

An explicit allow rule matches only when all of the following hold:

- `tool` equals the payload's `tool_name`.
- `match`, if present, is a substring of the command/file/path/url.
- `paths`, if present, matches at least one candidate path relative to the worktree root.

The glob engine is the same one used for `contract_delta`. The first matching `[[allow]]` wins and produces `allow`, but
only if no blast-radius trip matched first.

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

The record type is `DecisionRecord`: `ts`, `session`, `tool`, `summary`, `decision`, `rule`, `reverse`. `src/store.ts`
`appendDecision()` writes one JSON line per decision; `src/cli.ts status` prints the last five. The code produces rule
strings such as `blast:${trip}` or `policy.allow[${i}]`; the example above shows the intended shape.

**There is no path from an inbound message to a decision.** The engine reads `policy.toml`, the tool payload and the
repository. It never reads `.dkm/pending/`. `NFR-AUTH` asserts this by test.

## Surviving a usage limit

A long autonomous run ends when the account's usage limit is reached, and everything after that point is simply not
done. `dkm revive "<prompt>"` makes the limit a pause instead of an ending.

**It waits; it never evades.** The delay is the reset the server itself reported. There is no retry that runs sooner
than that, and no path that changes credentials or account.

**This is the one part of DKM that is not a hook.** `NFR-NODAEMON` governs ingest and emit, which still run only when
the harness fires a hook. The supervisor is a foreground process the human starts instead of starting `claude`, and it
lives for as long as the run does. Nothing schedules it, nothing runs in the background when it is not running, and
using it is opt-in.

### Detecting the limit

The contract is `claude --output-format json`. A limit is recognised when any of these hold, because a limit mistaken
for a crash ends the very loop this exists to protect:

- `api_error_status` is `429`
- `subtype`, `terminal_reason`, `stop_reason`, `result` or `error` contains `limit_reached`, `quota_exceeded`,
  `rate_limit`, `usage_limit` or `usage limit reached`
- the output could not be parsed as JSON at all, but the raw text carries one of those markers

`is_error` with none of the above is a genuine failure and stops the supervisor rather than being retried forever.

### Waiting and resuming

| Input                                              | Wait                                      |
| -------------------------------------------------- | ----------------------------------------- |
| A reset time between 1 minute and 6 hours away     | Until that time, plus a 30-second cushion |
| A reset time further away than 6 hours             | 6 hours, then re-check                    |
| A reset time already in the past, or none readable | `60s × 2^(attempt-1)`, capped at 6 hours  |

The reset time is read from an explicit `resetsAt` or `resetAt` field when present, otherwise from the phrase following
`reset` in the message. Epoch seconds, epoch milliseconds, an ISO timestamp and a bare clock time are all accepted; a
clock time that has already passed today rolls to tomorrow. A parsed time is trusted only inside that window, because a
misparse into the far future stalls the run until someone notices and one into the past spins against a live limit.

The first attempt starts a session from the prompt. **Every later attempt resumes the same session by id**, so the work
continues where the limit interrupted it. A limit that reports no session id stops the supervisor: restarting from the
prompt would repeat work already paid for and could repeat side effects.

Every pause appends to `.dkm/revivals.jsonl`, which is kept separate from `decisions.jsonl` so operational history does
not dilute the permission audit a human reads.

### What the hook contributes

`SessionEnd` writes `.dkm/last-session.json` with the session id, the cwd and the reason the harness gave, recorded
unexamined. A hook cannot tell a usage limit from a clean exit, and a hook that guessed would resume sessions nobody
wanted resumed.

## Loops and dedup keys

Assume at-least-once delivery. Assign `event_id` before any transport touches an event. **Never deduplicate on message
text** — identical prose can represent two distinct states.

| Loop       | Trigger and path                                         | Terminates when                   | Dedup key                                         |
| ---------- | -------------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| **Bind**   | `/dkm-bind <number>`, resolve, record                    | Binding is on disk                | repo node ID + worktree path                      |
| **Emit**   | `Stop`, compute delta, upsert comment                    | GitHub confirms and it reads back | repo + work item + session incarnation + head SHA |
| **Ingest** | `SessionStart` or `UserPromptSubmit`, fetch since cursor | The cursor has advanced           | comment ID + `updated_at`                         |
| **Inject** | Drain this worktree's queue, write to stdout             | The session has consumed it       | event ID + recipient worktree                     |
| **Decide** | `PermissionRequest`, evaluate policy, log, return        | A decision is returned            | session + tool-use ID                             |

The implementation of each loop:

- **Bind.** `src/cli.ts` handles `bind`. It calls `src/github.ts workItemByNumber()` to resolve the repo and item node
  IDs, then writes a `Binding` record to `.dkm/bindings.json`. The dedup key is the `repoNodeId` plus the worktree path.
- **Emit.** `src/hooks/stop.ts` measures the repository, `src/receipt.ts` renders the receipt and
  `src/github.ts upsertReceiptComment()` PATCHes an existing comment or POSTs a new one. The result is stored in
  `.dkm/last-emit.json` keyed by the work item's `itemNodeId`. The `unchanged()` check compares `head`, sorted
  `blockers` and a `checksFingerprint` (sorted `checkRunId:attempt:conclusion` strings joined by `|`). If all three
  match the last emit, no write happens.
- **Ingest.** `src/hooks/session-start.ts` and `src/hooks/user-prompt-submit.ts` call `src/hooks/inject.ts ingest()`.
  The function fetches repository events since the timestamp in `.dkm/cursor.json` and writes one
  `.dkm/pending/<eventId>.json` per event. `UserPromptSubmit` is throttled to once every 120,000ms so every prompt does
  not place a network call on the hot path. The cursor is advanced to the current time after a successful fetch.
- **Inject.** `src/hooks/inject.ts drainAndRender()` reads every `.dkm/pending/*.json` file, deletes it and writes the
  rendered text to stdout. The `PendingEvent` carries `eventId`, `rootId` and `hops`, but **nothing reads `hops` or
  `rootId` yet**: `ingest()` writes `hops: 0` and no code path increments or rejects on it. The fields reserve the
  shape; the hop budget is not enforced.
- **Decide.** `src/hooks/permission-request.ts` loads the policy, calls `src/decide.ts`, appends the log and emits the
  payload. The dedup key is effectively the `session_id` plus the tool-use being decided; the test suite confirms the
  log entry matches the returned decision.

**The emit condition is the entire anti-noise design.** A receipt is written only when head SHA, blocker set or check
state changed. `Stop` means "the agent finished a response", never "the work is done"; emitting on every `Stop` would
publish noise on a loop.

**There is no background poller.** Ingest is a cursored pull on the injection hooks. This keeps the no-daemon property
honest: nothing runs between firings, so nothing can die silently and leave a stale inbox looking healthy. The cost is
that a session learns of a receipt when it next starts or next receives a prompt — **live mid-turn delivery is v2**, and
needs a supervised lifecycle v1 deliberately does not have.

## Failure modes

- **Receipt storm** — Emit only on a real state delta. One mutable comment per work item, edited in place
- **Agent feedback loop** — Every event carries a root ID and a hop budget field. **The budget is not yet enforced**,
  and DKM does not currently relay events between sessions, so nothing republishes today
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
