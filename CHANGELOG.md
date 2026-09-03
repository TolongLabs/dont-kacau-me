# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before `1.0.0`, a minor bump may carry a breaking change;
those are called out under **Changed** with the word **Breaking**.

## [Unreleased]

## [0.2.0] — 2026-09-04

The release in which DKM was run inside a real Claude Code session for the first time, which falsified four of its hook
contracts at once.

### Added

- **Surviving a usage limit.** `dkm revive "<prompt>"` supervises a run: when it stops on a usage limit, the supervisor
  waits for the reset the server itself reported and resumes the same session by id. It waits, it never evades. Pauses
  are recorded in `.dkm/revivals.jsonl`
- A `SessionEnd` hook that records which session ended and the reason the harness gave, so a run can be resumed
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

- The tracking tier is resolved across every worktree rather than the reading one, and `.dkm/pending/` has no notion of
  a recipient, so with several sessions running the first to drain consumes the event ([#9])
- `loadPolicy` reads the worktree's own checkout instead of the shared store, so two worktrees on different branches can
  be governed by different policies ([#10])

## [0.1.0] — 2026-09-03

Initial implementation: the receipt, the decision engine, the hook bundle, the CLI, plugin packaging and CI. Verified
against a fake `gh` in a test harness only.

[unreleased]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/TolongLabs/dont-kacau-me/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TolongLabs/dont-kacau-me/releases/tag/v0.1.0
[#9]: https://github.com/TolongLabs/dont-kacau-me/issues/9
[#10]: https://github.com/TolongLabs/dont-kacau-me/issues/10
