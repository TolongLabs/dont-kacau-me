# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before `1.0.0`, a minor bump may carry a breaking change;
those are called out under **Changed** with the word **Breaking**.

## [Unreleased]

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

Initial implementation: the receipt, the decision engine, the hook bundle, the CLI, plugin packaging and CI. Verified
against a fake `gh` in a test harness only.

[unreleased]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TolongLabs/dont-kacau-me/releases/tag/v0.1.0
[#4]: https://github.com/TolongLabs/dont-kacau-me/issues/4
[#6]: https://github.com/TolongLabs/dont-kacau-me/issues/6
[#9]: https://github.com/TolongLabs/dont-kacau-me/issues/9
[#10]: https://github.com/TolongLabs/dont-kacau-me/issues/10
