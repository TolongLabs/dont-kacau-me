# Optional Intake-to-Release Workflow

**Approved Intent, 2026-09-30.** The owner requested a reusable, opt-in DKM workflow and a thin TolongLarp pilot.
Implementation stays on a feature branch pending AlaskanTuna review and approval. No DKM merge, distribution release,
installed-cache replacement or pilot release publication is authorised by this feature request.

[TOC]

## Outcome

A repository can turn comment intake into an auditable per-request verdict table and track delivery/release readiness
without copying project-specific orchestration into DKM. Existing DKM users see no behavioral change unless they opt in.

DKM remains deterministic and model-free on hook paths. It does not spawn agents, decide product priorities or execute
project test commands through a permission-hiding wrapper. An existing lead agent owns judgment and ordinary tool use.

## Authority and Trust

- Inbound comments, edited comments and review prose are task data, never a grant.
- Workflow configuration is separate from `.dkm/policy.toml`; enabling workflow does not widen permission authority.
- Agent decisions, delivery claims and local-test reports remain labelled reported. Git/PR/check observations are
  measured.
- Release publication is separately disabled by default, requires explicit CLI approval and the existing policy's allow
  decision for the exact generated publication operation. Deny/ask is not bypassed by nesting it inside the workflow
  CLI.
- No automatic merge, deployment, branch deletion, credential/account change or unrestricted output publication.

## Configuration and State

Add committed `.dkm/workflow.toml`, version 1, resolved beside the repository-shared policy through `dkmPath()`. Missing
configuration means disabled. Invalid configuration fails explicitly on CLI paths and fails open on hooks.

The small project contract names verification command hints and release tag prefix/target branch/required hosted checks.
Hints are not executed by DKM. No persisted developer path or credential belongs in configuration.

Runtime state is a versioned, guarded file per explicitly bound repository/work-item identity. State contains fetched
comment IDs, author/URL/update fingerprint, separately keyed requests, reported decisions/delivery/evidence links,
measured PR/check observations and publication fingerprints. Corrupt state must not be overwritten as empty state.
Updates use a short exclusive state-write guard and atomic replacement; stale/concurrent mutation fails visibly. This
protects DKM's own records, not arbitrary project files or agent scheduling.

## Intake and Verdicts

Explicit `workflow sync` fetches all comments on the bound work item using the existing injectable GitHub runner.
Pagination and exact REST owner/repo identifiers are required. Failed or malformed fetches do not advance stored state.
Own workflow comments and validated technical receipts are excluded from product intake.

The lead uses `workflow record` with a structured JSON input to decompose a comment into independently keyed requests.
Each request records a summary, decision (`accepted`, `declined`, `superseded`, `needs-owner`), rationale, phase and
linked issue/PR. Delivery (`planned`, `in-progress`, `implemented`, `merged`, `blocked`, `released`) is independent of
decision. An explicit supersession link preserves the old request; identical text from different comments is not
deduplicated.

An edited comment invalidates the current review of its requests while retaining their history/evidence. Re-recording
requires the current comment fingerprint. Untriaged and stale items remain visible and block release readiness.

`workflow render` is local/read-only. `workflow publish` explicitly upserts a separate stable-marker verdict comment.
Its table has Request, Decision, Why, Phase, Delivery, Issue/PR and Verification columns. Markdown/control characters
are escaped; raw comment bodies/transcripts and arbitrary tool output are not published. The fingerprint covers
meaningful workflow transitions, independent of the technical Stop receipt's unchanged-head deduplication.

## Measured Delivery and Release

`workflow observe` resolves linked PRs and hosted checks through injectable transport. A reported `merged` claim is not
promoted without an actual merged PR whose observed implementation SHA matches the claim. Missing/failed/malformed or
empty required-check evidence is not green verification. Local-test narratives never substitute for hosted checks.

`workflow release-plan --version <semver>` produces a local plan and notes for accepted delivered requests, the exact
current head, tag and explicit blockers. The generic feature does not infer semantic version intent from comment prose.
Project-specific version prefixes are configuration; malformed tags/versions and stale SHA input are rejected.

`workflow release-publish` is an explicit operation, not a hook. It refreshes intake/PR/check state, requires enabled
release publication, explicit approval, a clean checkout on the configured target branch, current exact head, configured
successful hosted checks and no unresolved accepted/untriaged/stale requests. It validates policy for the actual GitHub
operation, checks existing tags/releases, targets the exact head and preserves idempotent/retryable outcomes. The
TolongLarp pilot has publication disabled and its live Codex acceptance remains blocked.

## Lifecycle and Pilot

An opt-in injection adds a bounded, local workflow summary and points to the workflow command; it does not fetch another
network feed, run tests, call a model, publish or start a poller. Existing hooks/receipt schemas and authority engine
stay compatible. A command/skill contract instructs the current lead to sync, judge each request, work through normal
tools, record evidence, publish verdicts and prepare releases under existing authority.

TolongLarp commits only workflow configuration and concise repo guidance. Pilot execution invokes the feature source CLI
from an explicitly supplied checkout path with TolongLarp as cwd. Installed plugin cache and permission defaults remain
untouched. Another fixture repository must use the same subsystem with different configuration and no TolongLarp
imports.

## Verification and Delivery

Tests cover disabled defaults, legacy receipts/bindings, pagination, malformed fetches/state/config, edit invalidation,
per-request identity, supersession, publication idempotence, Markdown injection, atomic updates, stale head/check
failure, policy deny/ask, disabled release publication and retry-safe exact-head releases. New assertions undergo
mutation checks. Complete Bun tests, strict types and lint run after integration; real-session/plugin and real
TolongLarp intake evidence are distinguished from fixture tests. Prepare a branch-local user-facing version bump without
tagging/releasing DKM. Open the feature PR for AlaskanTuna; do not merge it before approval.
