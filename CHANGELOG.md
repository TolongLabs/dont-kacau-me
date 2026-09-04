# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before `1.0.0`, a minor bump may carry a breaking change;
those are called out under **Changed** with the word **Breaking**.

## [Unreleased]

## [0.4.2] — 2026-09-04

### Added

- `dkm init` checks that the directory is a git repository, and says `git init` when it is not. Run outside a repository
  the command previously failed with `not inside a git worktree`, which names the symptom rather than the fix.
- `dkm init` now says what to do after the policy is written, which was the question a first-run tester asked. The
  answer is a **second worktree**, not a second session in the same directory: recipients are keyed on worktree path and
  draining unlinks the event, so two sessions in one directory share a queue and race for the same events. The output
  gives the `git worktree add` line, the bind and follow commands, and says which steps need `gh`.

## [0.4.1] — 2026-09-04

### Added

- A `SessionStart` line naming the session's permission mode when that mode answers its own prompts, because a policy is
  inert in one and nothing said so. A first-run test under `--dangerously-skip-permissions` recorded no decision at all
  while every other hook fired, and the absence of prompts reasonably read as the policy working. Shown only where a
  policy file exists. `manual` and `plan` are treated as the asking modes; the rest are named rather than classified,
  since which of them suppress the event is the harness's contract to state.
- A README subsection comparing a DKM policy with `--dangerously-skip-permissions`, which removes the question rather
  than answering it.

### Fixed

- Slash commands no longer assume the human can read a command's stdout. Claude Code collapses a Bash result to one
  line, so `dkm-init` printed the entire onboarding — the failed check, the grant, the next step — into a fold, and the
  user saw `Ran 1 shell command` and asked what to do next. `dkm-init`, `dkm-status` and `dkm-note` now restate what
  matters in the reply, and a packaging test rejects any command that tells the model to show output "verbatim"
  ([#32](https://github.com/TolongLabs/dont-kacau-me/issues/32)).

## [0.4.0] — 2026-09-04

### Added

- `dkm init`, reachable as `/dont-kacau-me:dkm-init`. It checks Bun, `gh`, `gh` authentication and the GitHub remote,
  naming the command that fixes each failure, then writes a starter `.dkm/policy.toml` generated from the directories
  and package scripts the repository actually has. It never replaces an existing policy without `--force`, because that
  file is the human grant. Re-run it later to diagnose a repository.
- A `SessionStart` line telling an unbound worktree that it will publish no receipts, shown only where a policy file
  exists so a repository nobody opted into stays silent ([#25](https://github.com/TolongLabs/dont-kacau-me/issues/25)).

### Fixed

- **Blast-radius rules read paths from path-designating fields rather than from prose.** `outside-worktree` walked every
  string in a payload and split it on whitespace, so a `WebSearch` for `/etc/hosts`, a todo mentioning `/usr/local` and
  an `AskUserQuestion` offering `/dkm-init` were all denied. It is the one trip that returns `deny`, so those calls
  failed outright with no human fallback, and it could deny `AskUserQuestion` itself. `Bash` still has its whole command
  scanned ([#28](https://github.com/TolongLabs/dont-kacau-me/issues/28)).
- The ambient tier could never deliver an event. The repositories to poll were derived only from bound and followed
  items, so an ambient-only worktree produced an empty set and no query ran at all
  ([#24](https://github.com/TolongLabs/dont-kacau-me/issues/24)).
- `readJson` returned the module-level empty-state objects by reference, and callers mutate what they read, so one
  repository's state leaked into the next read for a different root in the same process
  ([#26](https://github.com/TolongLabs/dont-kacau-me/issues/26)).

### Changed

- Installing no longer starts with a clone: `claude plugin marketplace add TolongLabs/dont-kacau-me` takes the
  repository directly. Getting started now leads with the policy half, which works in one session with no GitHub issue.
- The commands table no longer lists `dkm revive` as though it were typeable. There is no `dkm` binary; the supervisor
  is started as `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts revive`, as the section below the table already showed.

### Known limitations

- `money`, `egress` and part of `data-loss` still match command patterns anywhere in a payload, so text containing
  `deploy` or `delete from` causes a redundant prompt. Each returns `ask`, so the cost is a prompt rather than a failure
  ([#29](https://github.com/TolongLabs/dont-kacau-me/issues/29)).

## [0.3.0] — 2026-09-04

Closes every issue that was open at 0.2.0.

### Added

- Ingest measures its own wall clock against an 8s default budget. It stops later repository queries and skips receipt
  enrichment for already-fetched events after the budget, so those events render as headlines. A receipt is fetched once
  per ingest however many worktrees receive it. Measured against a live repository: a cursored issue fetch of 30 items
  takes 0.78–1.27s and a single comment fetch 0.42–1.01s, against a 15s hook timeout ([#4])

### Fixed

- Delivery is now per recipient. `.dkm/pending/` is one queue per worktree and the tracking tier is resolved for the
  worktree that is reading, so a followed item is no longer labelled bound and one session no longer consumes another's
  event ([#9])
- The receipt's decision summary starts at the prior successful emit's global log offset, then counts matching-session
  records instead of the session's whole lifetime ([#6])
- One repository, one policy. `loadPolicy` resolves through the shared store instead of the caller's own checkout, so a
  session cannot be governed by — or change — a policy on its own branch ([#10])

## [0.2.0] — 2026-09-04

The release in which DKM was run inside a real Claude Code session for the first time, which falsified four of its hook
contracts at once.

### Added

- **Surviving a usage limit.** `revive` supervises a run: after a recognised limit, it uses the reported reset when
  usable, caps one wait at six hours and otherwise applies exponential backoff. It resumes the reported session ID;
  waits and terminal outcomes are recorded in `.dkm/revivals.jsonl`
- A `SessionEnd` hook that records which session ended and the reason the harness gave. The current supervisor obtains
  its resume ID from Claude's JSON result and does not read this ticket
- Ingest now fills in the receipt for a bound or followed item, so a **followed** item arrives as a contract delta and
  head SHA rather than a bare headline
- `.dkm/` on the blast-radius table. Nothing previously protected `.dkm/policy.toml`, so an agent holding a broad write
  grant could widen the grant governing it
- Architecture and receipt-flow diagrams, and a marketplace manifest so the plugin can be installed rather than only
  loaded with `--plugin-dir`

### Fixed

- **Breaking, and the reason for this release.** `PermissionRequest` emitted a payload shape the harness does not
  recognise. Because an unrecognised payload is read as a _hook failure_, every `allow` became a **deny**: installing
  DKM made a session strictly worse than not installing it, and the documented "fails open to `ask`" was false. The
  correct shape nests `hookEventName` and `decision.behavior`; there is no wire form for `ask`, and emitting `{}` is
  what hands the prompt back to the human
- **Breaking.** The `WorktreeCreate` and `WorktreeRemove` handlers are removed. Both are _provider_ hooks: one is
  expected to create the worktree and echo its path, and a handler that echoes nothing aborts worktree creation
  entirely. Their payload carries `name`, never the `worktree_path` and `branch` DKM read. Binding runs through
  `/dont-kacau-me:dkm-bind`
- `fetchSince` interpolated the repository node ID into a REST path that needs `owner/repo`, so every ingest returned
  404 and fail-softed to nothing. The whole delivery half of the product was inert
- The CLI keyed the session report on `CLAUDE_SESSION_ID`, which Claude Code does not export. Narrative and blockers
  were written to a file the `Stop` hook never opened

### Changed

- Slash commands are invoked as `/dont-kacau-me:<command>`, which is how Claude Code namespaces a plugin's commands
- `docs/TRD.md` is deepened to implementation level, and two claims it could not support were corrected:
  `parseReceipt()` reads the _first_ fenced JSON block, and the hop budget that "never republishes a relayed event" does
  not exist — `rootId` and `hops` are written but never read

### Known limitations

- A queued event is removed when a session drains it. Nothing records whether the model acted on it, so an injected
  delta the agent ignored looks identical to one it used

## [0.1.0] — 2026-09-03

Initial implementation included:

- the receipt
- the decision engine
- the hook bundle
- the CLI
- plugin packaging
- CI

It was verified against a fake `gh` in a test harness only.

[unreleased]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.3.0...HEAD
[0.4.2]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TolongLabs/dont-kacau-me/releases/tag/v0.1.0
[#4]: https://github.com/TolongLabs/dont-kacau-me/issues/4
[#6]: https://github.com/TolongLabs/dont-kacau-me/issues/6
[#9]: https://github.com/TolongLabs/dont-kacau-me/issues/9
[#10]: https://github.com/TolongLabs/dont-kacau-me/issues/10
