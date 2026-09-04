# TRD.md

**How DKM is built.** Canonical over [`AGENTS.md`](../AGENTS.md) on technical detail. Implements [`PRD.md`](PRD.md).

This reference describes the behavior present in `src/`, the plugin manifests and the test suite. The
[`README.md`](README.md) keeps the user-facing narrative; this file names exact payloads, paths, commands and known
boundaries.

Contents:

1. [Architecture](#architecture)
1. [Storage layout](#storage-layout)
1. [Hook contracts](#hook-contracts)
   1. [`PermissionRequest`](#permissionrequest)
   1. [Worktree lifecycle events](#worktree-lifecycle-events)
   1. [Injection hook output](#injection-hook-output)
   1. [`Stop`](#stop)
   1. [`SessionEnd`](#sessionend)
1. [Receipt contract](#receipt-contract)
   1. [Receipt rendering and parsing](#receipt-rendering-and-parsing)
   1. [Receipt emission](#receipt-emission)
1. [Tracking and ingest](#tracking-and-ingest)
1. [Policy and decision engine](#policy-and-decision-engine)
   1. [Policy parser](#policy-parser)
   1. [Blast-radius evaluation](#blast-radius-evaluation)
   1. [Allow-rule evaluation](#allow-rule-evaluation)
   1. [Decision records](#decision-records)
1. [Usage-limit supervisor](#usage-limit-supervisor)
   1. [Run classification](#run-classification)
   1. [Wait calculation](#wait-calculation)
   1. [Resume loop](#resume-loop)
1. [Identity and replay boundaries](#identity-and-replay-boundaries)
1. [Known implementation limits](#known-implementation-limits)
1. [Test coverage](#test-coverage)
1. [Recorded measurements](#recorded-measurements)

## Architecture

DKM is distributed as a Claude Code plugin. `.claude-plugin/plugin.json` identifies the plugin,
`.claude-plugin/marketplace.json` makes the clone a marketplace source, `hooks/hooks.json` registers handlers and
`commands/*.md` supplies slash-command frontmatter.

The registered commands in `hooks/hooks.json` are:

| Event               | Entrypoint                        | Timeout | Matcher  |
| ------------------- | --------------------------------- | ------- | -------- |
| `PermissionRequest` | `src/hooks/permission-request.ts` | 5s      | None     |
| `Stop`              | `src/hooks/stop.ts`               | 20s     | None     |
| `SessionStart`      | `src/hooks/session-start.ts`      | 15s     | `startup | resume | clear` |
| `UserPromptSubmit`  | `src/hooks/user-prompt-submit.ts` | 15s     | None     |
| `SessionEnd`        | `src/hooks/session-end.ts`        | 10s     | None     |

Each command invokes Bun through `${CLAUDE_PLUGIN_ROOT}`. No registered hook imports or calls a model. Repository work
uses synchronous local file operations, `git` child processes and `gh` child processes.

The hot path is not limited to one `gh` call. A receipt emission calls `fetchChecks()`, then `upsertReceiptComment()`,
which lists comments before it PATCHes or POSTs. Ingest calls `fetchSince()` for each tracked repository ID and may call
`findReceiptComment()` for each claimed item until its wall-clock budget is spent.

`src/github.ts defaultRunner()` gives each `gh` process a 10-second timeout. `src/hooks/runtime.ts repoRoot()` and
`src/store.ts dkmPath()` give their `git rev-parse` calls 5-second timeouts; commands issued through `src/git.ts` do not
set a child-process timeout.

Receipt, ingest and decision work exists only in hook processes. `src/revive-run.ts` is the exception to pure-hook
execution: it is an opt-in foreground supervisor started through the CLI. It is not a daemon and does not poll for
repository events.

DKM assumes sessions use separate git worktrees; it does not create or enforce that isolation. `repoRoot()` resolves the
caller's worktree with `git rev-parse --show-toplevel`. `dkmPath()` resolves shared state from the parent of
`git rev-parse --git-common-dir`.

## Storage layout

The `.gitignore` rules ignore `.dkm/*` and re-include `.dkm/policy.toml`. Most runtime state is therefore disposable,
while the policy is committed as the installer's grant.

| Path                                 | Location        | Writer or reader                                   | Shape                     |
| ------------------------------------ | --------------- | -------------------------------------------------- | ------------------------- |
| `.dkm/policy.toml`                   | Shared store    | `loadPolicy()`                                     | Restricted TOML subset    |
| `.dkm/bindings.json`                 | Shared store    | `readBindings()` / `writeBindings()`               | `BindingsFile`            |
| `.dkm/cursor.json`                   | Shared store    | `readCursors()` / `writeCursors()`                 | `CursorFile`              |
| `.dkm/pending/<recipient>/<id>.json` | Shared store    | `writePending()` / `drainPending()`                | One `PendingEvent`        |
| `.dkm/decisions.jsonl`               | Shared store    | `appendDecision()` / `readDecisions()`             | One `DecisionRecord`/line |
| `.dkm/last-emit.json`                | Shared store    | `readLastEmit()` / `writeLastEmit()`               | `LastEmitFile`            |
| `.dkm/revivals.jsonl`                | Shared store    | `appendRevival()`                                  | One `RevivalRecord`/line  |
| `.dkm/last-session.json`             | Shared store    | `writeResumeTicket()` / `readResumeTicket()`       | `ResumeTicket`            |
| `.dkm/report/<session>.json`         | Caller worktree | `readReport()` / `writeReport()` / `clearReport()` | `SessionReport`           |

Here, **shared store** means `join(dkmPath(root), ...)`, normally under the main worktree. The report is the deliberate
code-level exception: `src/hooks/report.ts reportPath()` uses `join(root, '.dkm', ...)`, so a linked worktree keeps its
own session report beside that checkout.

Only `BindingsFile`, `CursorFile` and `LastEmitFile` carry a top-level `version: 1`. `PendingEvent`, `Receipt` and
`DecisionRecord` have runtime guards but no version field. `SessionReport` and `ResumeTicket` are read with their own
field checks.

`readJson()` returns an empty default after a missing file, parse failure or guard failure. Invalid JSONL lines are
skipped. An invalid pending file is not returned and `drainPending()` leaves it on disk because deletion happens only
after `isPendingEvent()` succeeds.

`writeJson()`, `writeResumeTicket()` and `writeReport()` write a temporary file and rename it. Decision and revival
records use append-only JSONL. `clearReport()` removes the per-session report after a successful receipt write.

## Hook contracts

`src/hooks/runtime.ts HookPayload` names `session_id`, `cwd`, `hook_event_name`, `permission_mode`, `stop_hook_active`,
`tool_name`, `tool_input` and `reason`. At runtime, `readPayload()` validates only that the input is an object with
string `session_id` and `cwd`; the other fields are consumed conditionally by individual handlers.

| Hook                | Required by its handler                    | Normal side effect                                             |
| ------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `PermissionRequest` | `tool_name`; `tool_input` may be any value | Append a decision record, then emit a decision object or `{}`  |
| `Stop`              | Valid `cwd`; optional `stop_hook_active`   | Measure a bound worktree and possibly upsert its receipt       |
| `SessionStart`      | Valid `cwd`                                | Run ingest, drain this recipient queue and write rendered text |
| `UserPromptSubmit`  | Valid `cwd`                                | Run throttled ingest, drain and write rendered text            |
| `SessionEnd`        | Valid `cwd`; optional string `reason`      | Atomically replace `.dkm/last-session.json`                    |

`runHook()` wraps `SessionStart`, `UserPromptSubmit` and `SessionEnd`. It catches handler errors, writes nothing after
an error and exits 0. `Stop` and `PermissionRequest` use their own top-level catch paths and also exit 0.

### `PermissionRequest`

`src/hooks/permission-request.ts emit()` uses these two non-empty wire shapes:

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }
```

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "deny", "message": "DKM blast:outside-worktree" } } }
```

There is no emitted `behavior: "ask"`. The default, blast-radius `ask`, malformed input, missing repository and caught
exception paths all emit `{}`. On a normal evaluation, `appendDecision()` runs before `emit()`; if logging itself
throws, the catch path emits `{}` without a record.

The deny message is `DKM ${verdict.rule}`. An allow payload carries no message or updated input. The source never emits
`hookSpecificOutput.additionalContext`.

### Worktree lifecycle events

`hooks/hooks.json` registers neither `WorktreeCreate` nor `WorktreeRemove`. Binding is performed by
`bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts bind <number>`, which is the command in `commands/dkm-bind.md`.

`test/e2e.test.ts bind()` records why: these Claude Code events are provider hooks, and a `WorktreeCreate` handler that
does not return a path aborts creation. DKM therefore does not use either event for observation.

### Injection hook output

`src/hooks/session-start.ts` calls `ingest(root)` and then `drainAndRender(root)`. The prompt hook calls the same
functions with `REFETCH_INTERVAL_MS = 120_000`.

When the queue is non-empty, `render()` writes plain text grouped under `bound`, `followed` and `ambient`. A queued
event with a receipt becomes a single line in this shape:

```text
#81 a1b2c3d → e5f6g7h · contract: src/types.ts · 2 check(s) failing · blockers: retry policy
```

The contract, checks and blockers segments are omitted when their source arrays are empty. A receipt with checks and no
failures renders `checks <count>/<count> pass`. An event without a receipt renders its headline and URL:

```text
#82 Headline of the issue — https://github.com/owner/repo/issues/82
```

The output ends with `SHAs are as observed; re-read a file before acting if head has moved since.` The code does not
perform that head comparison itself.

### `Stop`

`src/hooks/stop.ts` returns before repository work when:

- `readPayload()` rejects the input
- `stop_hook_active` is `true`
- `repoRoot()` fails
- no binding matches the resolved worktree path
- the matching binding has no bound item

The re-entrancy check prevents nested `Stop` handling. Every successful path writes no stdout, whether or not it updates
a comment.

### `SessionEnd`

`src/hooks/session-end.ts` writes `sessionId`, `cwd`, `reason` and `endedAt`. A missing or non-string reason becomes
`unknown`; the handler does not interpret it.

`readResumeTicket()` exists, but no production caller uses it. The usage-limit supervisor obtains its session ID from
Claude's JSON result instead, so `.dkm/last-session.json` is currently diagnostic state rather than resume input.

## Receipt contract

`src/types.ts Receipt` is the canonical in-process shape. Trust labels below describe provenance; they are not
serialized as per-field `kind` properties.

| Field           | Type or members                               | Producer                                       | Trust      |
| --------------- | --------------------------------------------- | ---------------------------------------------- | ---------- |
| `eventId`       | `string`                                      | `crypto.randomUUID()`                          | Generated  |
| `workItem`      | `repoNodeId`, `itemNodeId`, `number`, `kind`  | Bound `WorkItemRef`                            | Measured   |
| `base`          | `string`                                      | `git merge-base HEAD <ref>`                    | Measured   |
| `head`          | `string`                                      | `git rev-parse HEAD`                           | Measured   |
| `changedPaths`  | `{ status, path }[]`                          | `git diff --name-status <base>..<head>`        | Measured   |
| `checks`        | `{ name, checkRunId, attempt, conclusion }[]` | GitHub check-runs response                     | Measured   |
| `contractDelta` | `string[]`                                    | `changedPaths` matched against `contractGlobs` | Measured   |
| `decisions`     | `{ allowed, denied, asked }`                  | Local decision-log slice                       | Measured   |
| `blockers`      | `string[]`                                    | Session report                                 | Reported   |
| `narrative`     | `string`                                      | Session report                                 | Unverified |
| `observedAt`    | ISO timestamp string                          | `new Date().toISOString()`                     | Generated  |

`ChangedPath.status` accepts `A`, `M`, `D`, `R` and `C`. For a rename or copy, `changedPaths()` stores only the
destination path. Unknown status letters and malformed output rows are skipped.

`fetchChecks()` runs:

```text
gh api repos/{owner}/{repo}/commits/<head>/check-runs
```

It maps any non-completed check to `pending`. Completed conclusions are limited to `success`, `failure`, `neutral`,
`cancelled`, `timed_out` and `skipped`; any other conclusion also becomes `pending`. A missing `run_attempt` becomes
`1`, while a failed or malformed response becomes an empty checks array.

`resolveBaseRef()` tries `origin/HEAD`, `origin/main` and `origin/master` in that order. If all three merge-base calls
fail, receipt emission falls through the top-level catch and exits without publishing.

### Receipt rendering and parsing

`renderReceipt()` starts with `<!-- dkm:receipt v1 -->` and ends with `<!-- /dkm:receipt -->`. Between the markers it
renders:

1. An H1 naming the work-item number.
1. A table containing `base`, `head` and `observed_at`.
1. An unlabeled list of changed paths.
1. A check table containing name, run ID, attempt and conclusion.
1. An unlabeled list of contract paths.
1. One decision-count line.
1. A block-quoted `Unverified agent narrative` section.
1. The full `Receipt` object in a fenced `json` block.

`blockers` appears in the fenced object, not as a separate human-readable section. The fence length is longer than any
backtick run inside the JSON, with a minimum of three backticks.

`parseReceipt()` requires both outer markers, then scans from the top for the **first** line matching a three-or-more
backtick fence followed by `json`. It parses through a closing fence of the same length and validates every required
`Receipt` field. The guard does not reject extra object keys.

### Receipt emission

`Stop` computes the head, merge base, changed paths, policy contract delta, GitHub checks and this session's report. It
looks up prior state in `lastEmit.emitted[binding.bound.itemNodeId]`.

With no prior state, the first bound `Stop` publishes a baseline. Later, `unchanged()` suppresses publication when all
three values match:

- `head`
- sorted `blockers`
- `checksFingerprint`, formed from sorted `checkRunId:attempt:conclusion` strings

Changes to `base`, `changedPaths`, `contractDelta`, `decisions`, `narrative` or `observedAt` do not independently
trigger an emit. `receiptFingerprint()` uses the same three semantic inputs, but `Stop` calls its own `unchanged()`
helper rather than that exported function.

`summariseDecisions()` starts at the previous state's global `decisionOffset`, then counts only records whose `session`
matches the current `session_id`. The new offset is the total log length before publication. The result therefore covers
matching-session records appended since this work item's prior successful emit, not the session's lifetime.

`upsertReceiptComment()` first lists `repos/{owner}/{repo}/issues/<number>/comments` and selects the first body
beginning with the receipt marker. It PATCHes `repos/{owner}/{repo}/issues/comments/<id>` when found or POSTs to the
issue comments endpoint otherwise. GitHub's returned comment ID is stored; the body is not fetched again for readback.

Only after the upsert succeeds does `Stop` update `last-emit.json` and clear the session report. A thrown measurement or
GitHub error is swallowed by the top-level catch, leaving the previous state and report available for another attempt.

## Tracking and ingest

`Binding` contains `worktreePath`, one optional bound `WorkItemRef`, an array of followed items and an `ambient`
boolean. The CLI creates a binding with `ambient: true`; there is no CLI command to toggle it.

For each recipient, `tierFor()` compares an event's item node ID with the bound item first and followed items second. If
neither claims it, `ingest()` queues it as ambient only when that recipient's `ambient` flag is true. The same event may
therefore be bound for one worktree, followed for another and ambient for a third without duplicating a tier inside one
recipient queue.

Bound and followed events are not rendered at different depths. When a receipt is available, both use `line()` to render
the same base-to-head, contract, check and blocker summary. The tier heading is their only presentation difference.

`fetchSince()` invokes:

```text
gh api repos/{owner}/{repo}/issues?since=<encoded-ISO>&state=all&sort=updated&per_page=30
```

The endpoint returns issues and PRs updated since the cursor. `fetchSince()` does not implement @mention detection,
base-branch CI events or a raw commit feed. It invokes the endpoint without a `--jq` projection, so response bodies may
be present in `gh` stdout and the parsed response; only `node_id`, `number`, `title`, `html_url`, `updated_at` and PR
kind survive into `AmbientEvent` and `PendingEvent`.

`trackedRepoIds()` derives repository node IDs from bound and followed items. The ID keys the cursor, but
`fetchSince(root, since)` addresses the repository selected by the current checkout through `{owner}/{repo}`; it does
not use the node ID in the REST path.

With no cursor, ingest queries from 24 hours before `Date.now()`. `UserPromptSubmit` skips a repository whose cursor is
less than 120,000ms old. After `fetchSince()` returns, ingest stores `new Date().toISOString()` as the cursor.

`fetchSince()` returns an empty array for both a successful empty response and a failed or malformed response. Because
`ingest()` cannot distinguish those cases, it advances the cursor after either one. There is no acknowledgement or
replay window around that update.

`ingest(root, minIntervalMs, budgetMs, now)` defaults `budgetMs` to 8,000. It checks elapsed wall time before each issue
query and before each receipt lookup. Once over budget, it stops later repository queries and queues remaining events
without receipts, leaving them to render as headlines.

One ingest memoizes each receipt by `itemNodeId`, so several recipients of the same item share one comment lookup. The
budget cannot interrupt a synchronous `gh` call already in progress.

`recipientKey()` is the first 16 hexadecimal characters of SHA-256 over the worktree path. A pending path is
`.dkm/pending/<recipient>/<eventId>.json`; `writePending()` rejects event IDs containing `/` or `..` and recipient keys
outside the expected hexadecimal shape.

For fetched GitHub items, `eventId` and `rootId` are both the item node ID and `hops` is `0`. A later undrained update
to the same item overwrites the same file. `rootId` and `hops` are shape-checked but never read for control flow: no hop
budget, increment or relay rejection is implemented.

`drainPending()` deletes each valid event before `render()` writes stdout. There is no delivery acknowledgement from the
harness or model, so a write or consumption failure after deletion cannot be distinguished from successful use.

## Policy and decision engine

`loadPolicy(root)` reads `join(dkmPath(root), 'policy.toml')`. A linked worktree therefore uses the main worktree's
policy rather than a policy from its own branch. A missing or unreadable file returns an empty version-1 policy.

### Policy parser

`src/policy.ts` is a line parser, not a general TOML parser. It supports:

- `#` comments outside single or double quotes
- single-quoted and double-quoted strings
- one-line string arrays separated by commas outside quotes
- repeated `[[allow]]` tables
- the top-level `contractGlobs` key

The committed file contains `version = 1`, but the parser does not read the key. It initializes every returned policy
with `version: 1`. Unknown keys and tables are skipped.

Each `[[allow]]` rule may set `tool`, `match` and `paths`. A new table begins as `{ tool: '' }`; the parser does not
reject an incomplete rule. `contractGlobs` feeds `src/git.ts contractDelta()` and has no effect on permission matching.

### Blast-radius evaluation

`decide()` evaluates trips in this exact order before it considers an allow rule:

| Trip               | Decision | Predicate in `src/decide.ts`                                                                                         |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `outside-worktree` | `deny`   | Any recursively found string or whitespace token resolves outside `worktreePath`                                     |
| `data-loss`        | `ask`    | Recursive forced `rm`, destructive SQL substring, or a resolved path segment equal to `migrations` or `drizzle`      |
| `money`            | `ask`    | `npm publish`, `bun publish`, `vercel deploy` or `gh release create`                                                 |
| `egress`           | `ask`    | `curl`, `wget`, `git push`, selected deploy commands, selected `gh` creates/comments or `gh api ... -X <write verb>` |
| `surface`          | `ask`    | A supported lockfile, `package.json`, `.env`, `.env.*` or any resolved path containing a `.dkm` segment              |

The data-loss SQL substrings are `drop table`, `drop column`, `truncate` and `delete from`, matched case-insensitively.
The `rm` matcher requires recursive and force flags before `--`, either separately or in one short option.

The egress matcher recognizes `bun run deploy`, `npm run deploy`, any other command containing the word `deploy`,
`gh pr create`, `gh issue create`, `gh pr comment`, `gh issue comment`, and `gh api` with `-X POST`, `PATCH`, `PUT` or
`DELETE`. `vercel deploy` is excluded from this matcher because the earlier `money` trip catches it.

The surface filenames are `bun.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `package.json` and `.env`. The
implementation does not inspect TypeScript exports or otherwise detect a general exported API surface.

`collectPathCandidates()` recursively extracts every string from `tool_input`, then adds each whitespace-separated
token. `outside-worktree`, data-loss path checks and surface checks all operate on that candidate set. This is
intentionally an exact description: the engine does not distinguish a path field from an arbitrary string before
resolving candidates.

### Allow-rule evaluation

After all blast-radius checks pass, allow rules are visited in file order. A rule matches only when:

- `rule.tool` equals `tool_name`
- `rule.match`, when present, is a literal substring of the first string-valued `command`, `file_path`, `path` or `url`
- `rule.paths`, when present and non-empty, matches at least one in-worktree candidate path

The path condition is **any-match**, not all-match. An input containing several in-worktree paths may be allowed when
one matches the rule even if another does not. The earlier outside-worktree trip still denies when any candidate
resolves outside the worktree.

Permission path globs use `decide.ts globToRegex()`: `*` excludes `/`, `**` includes it and `?` matches one character.
Contract globs use the separate segment matcher in `src/git.ts`; the two implementations are not the same function.

The first matching allow rule returns `allow` with `rule: policy.allow[<zero-based-index>]`. With no match, `decide()`
returns `ask`, `rule: default` and no blast trip.

`src/decide.test.ts` asserts that `decide.ts` imports neither the store nor GitHub or hook modules and contains no file,
network or child-process read. The permission result is therefore a function of `DecisionInput` and `Policy`; pending
events cannot become grants through this engine.

### Decision records

On the normal handler path, each result becomes:

```json
{
  "ts": "2026-09-03T15:04:05.000Z",
  "session": "abc123",
  "tool": "Bash",
  "summary": "bun test",
  "decision": "allow",
  "rule": "policy.allow[3]",
  "reverse": "n/a"
}
```

`summary` is the first string-valued `command`, `file_path`, `path` or `url`, truncated to 200 characters; otherwise it
is the tool name. `reverse` is `blocked on <trip>` for a blast-radius result and `n/a` for an allow or default ask. It
is not currently a reversal instruction.

`appendDecision()` writes one JSON line before `emit()`. `status()` reports the total valid-record count and renders the
last five records across all sessions. Invalid JSONL lines are skipped by `readDecisions()`.

## Usage-limit supervisor

From the plugin clone, the CLI entrypoint is:

```bash
bun src/cli.ts revive "<prompt>" -- <claude arguments>
```

`src/cli.ts` passes `maxAttempts: 24`. `src/revive-run.ts buildArgv()` builds the first invocation as:

```text
claude --output-format json <claude arguments> -p <prompt>
```

Once a session ID is known, later invocations become:

```text
claude --output-format json <claude arguments> --resume <session-id> -p Continue where you left off.
```

### Run classification

`classify()` parses stdout when stdout is non-empty; otherwise `runSupervised()` passes stderr. The child process status
is collected but not consulted when classifying the run.

A result is a limit when numeric `api_error_status` equals `429`, or when one of these fields contains a marker:

- `subtype`
- `terminal_reason`
- `stop_reason`
- `result`
- `error`

The markers are `limit_reached`, `quota_exceeded`, `rate_limit`, `usage_limit` and `usage limit reached`, compared after
lowercasing. Unparseable output is also searched for those markers. Without one, unparseable output is a failure.

A parsed object with `is_error: true` and no limit marker is a failure. Other parsed objects are treated as done, with
`result` reduced to a string or an empty string.

Only string-valued `resetsAt` and `resetAt` fields are read explicitly. Otherwise `resetSource()` extracts up to 60
characters after a `reset`, `resets`, `reset at` or `reset in` phrase from the combined signal fields.

`parseResetAt()` accepts an all-digit epoch string of 9–13 digits, an ISO-like timestamp, or a bare local clock time.
Epochs of at most 10 digits are seconds; longer epochs are milliseconds. A bare clock at or before the current local
time rolls to the next day.

### Wait calculation

| Input                                                         | `waitFor()` result                       |
| ------------------------------------------------------------- | ---------------------------------------- |
| Parsed reset plus 30 seconds is 1 minute through 6 hours away | Exact delta plus the 30-second cushion   |
| Parsed reset plus cushion is more than 6 hours away           | 6 hours                                  |
| Parsed reset is too near, in the past or absent               | `60s × 2^(attempt-1)`, capped at 6 hours |

The constants are `MIN_WAIT_MS = 60_000` and `MAX_WAIT_MS = 21_600_000`. The default sleep uses `Atomics.wait()` in the
foreground process.

### Resume loop

`runSupervised()` appends a `waiting` record before every sleep and appends `done`, `failed` or `unresumable` on those
terminal paths. If a limit result has no session ID, it records `unresumable` and stops rather than replaying the
prompt.

The final allowed attempt does not sleep. If it also returns a limit, the function returns that limit after
`maxAttempts`; it does not append a separate terminal revival record for exhaustion.

## Identity and replay boundaries

The implementation uses these concrete keys:

| Operation | Persistent key or filename                        | Current replay behavior                                             |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Bind      | Exact `worktreePath` plus resolved `WorkItemRef`  | A later bind replaces that worktree's bound item                    |
| Emit      | `lastEmit.emitted[itemNodeId]`                    | Same head, blocker set and check fingerprint suppress a later write |
| Comment   | First issue comment whose body starts with marker | PATCH that comment; otherwise POST a new one                        |
| Ingest    | `cursors[repoNodeId]`                             | Query from timestamp, then replace it with current time             |
| Queue     | `<recipientKey>/<itemNodeId>.json`                | An undrained update for the same item overwrites the file           |
| Drain     | Valid pending filename                            | Delete before rendered stdout is written                            |
| Decide    | No dedup key                                      | Every normal handler firing appends another record                  |

`eventId` is assigned with `crypto.randomUUID()` for receipts and with the GitHub item node ID for fetched events. There
is no session-incarnation key, comment `updated_at` key, tool-use ID deduplication or acknowledgement protocol.

## Known implementation limits

- **Initial baseline write.** The first bound `Stop` publishes even when no worktree state changed during that turn.
- **Incomplete stale detection.** Receipts carry an observed head, but ingest does not fetch the current PR head or
  reject a stale receipt.
- **Narrow ambient source.** The only ambient source is the updated issues endpoint; @mentions and base-branch CI
  failures are not implemented.
- **Response bodies cross the process boundary.** The issues request does not project fields at the `gh` boundary.
  Bodies are discarded before `AmbientEvent`, but may be present transiently in command output and parsed JSON.
- **Cursor advances after a failed read.** `fetchSince()` collapses failure and an empty response to `[]`, so ingest can
  move the cursor past an interval it did not receive.
- **No delivery acknowledgement.** Drain deletes a valid event before stdout is accepted or model use is known.
- **No hop enforcement.** `rootId` and `hops` are written and shape-checked but never read. DKM also has no current
  relay path, so pending events are not republished by the existing code.
- **Bound and followed depth is identical.** Both tiers render the same receipt-derived line.
- **Report storage differs from other state.** Reports are worktree-local; the other state paths use the shared store.
- **A report alone may wait.** Narrative and decision changes do not trigger an emit; they appear only when a baseline,
  head, blocker or check change causes publication.
- **GitHub read failures are ambiguous.** A failed check fetch looks like zero checks, while failed ambient fetch looks
  like no events.
- **Hook timing is not guaranteed by child timeouts.** A `Stop` can issue three sequential `gh` calls with 10-second
  child timeouts inside a 20-second hook timeout, and `src/git.ts` sets no timeout.
- **Allow paths use any-match.** One matching in-worktree path can satisfy a rule containing several candidate paths.
- **Resume ticket is unused.** `SessionEnd` writes `.dkm/last-session.json`, but the supervisor never reads it.
- **Detached-head handling is unused.** `isDetachedHead()` exists and has unit coverage, but no hook or CLI caller uses
  it to alter behavior.

## Test coverage

The repository's test sources currently cover:

| Test source                | Verified behavior                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/decide.test.ts`       | Outside, data-loss, egress and surface trips; allow rules; default ask; static consent boundary  |
| `src/git.test.ts`          | Head/base resolution, detached-head detection, changed-path parsing and contract-glob behavior   |
| `src/github.test.ts`       | Exact GitHub argv, response narrowing, receipt upsert and work-item resolution                   |
| `src/receipt.test.ts`      | Receipt round-trip, invalid/truncated input and head/blocker/check fingerprint inputs            |
| `src/store.test.ts`        | Defaults, corrupt input, atomic JSON writes, pending drain and JSONL filtering                   |
| `src/hooks/inject.test.ts` | Receipt memoization and wall-clock budget branches                                               |
| `src/revive*.test.ts`      | Classification, reset parsing, wait calculation, resume argv, terminal paths and revival logging |
| `test/cli.test.ts`         | Explicit bind/follow, report commands, status and invalid input                                  |
| `test/e2e.test.ts`         | Hook output, logging, baseline/idempotency, per-recipient delivery and fail-open paths           |
| `test/plugin.test.ts`      | Manifest inventory, handler paths, command roots, version alignment and licence                  |
| `test/worktree.test.ts`    | Shared bindings and policy resolution across a linked worktree                                   |

The source does **not** currently contain a consumer stale-head rejection test, a money-trip unit test, a 5,000-commit
timing test, or a test proving every narrative-only update emits. The last behavior is intentionally false under the
current emit predicate.

## Recorded measurements

The `0.3.0` entry in [`CHANGELOG.md`](../CHANGELOG.md) preserves the live measurements attached to issue #4: a cursored
issue fetch of 30 items took 0.78–1.27s and one comment fetch took 0.42–1.01s against a 15s injection-hook timeout. The
current source responds with an 8,000ms ingest budget and per-ingest receipt memoization; the repository does not
contain a benchmark that reproduces those timings.
