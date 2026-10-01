# Intake-to-Release Implementation Plan

> **For Agentic Workers:** Use `superpowers:executing-plans` inline with TDD and a final fresh source review. The owner
> explicitly approved implementation; do not insert another approval pause. DKM merge/distribution and pilot release
> publication remain blocked pending AlaskanTuna approval and independent release authority.

**Goal:** Add an optional reusable intake/verdict/delivery/release workflow and adopt it in TolongLarp through thin
config.

**Architecture:** Separate workflow config/state/transitions/transport/CLI from permission policy and technical
receipts. The existing lead agent supplies product judgments; deterministic adapters observe GitHub/Git and render
bounded output. Hooks add local summaries only. Publication must consult existing policy independently of inbound
workflow data.

**Tech Stack:** Existing strict TypeScript, Bun, atomic JSON stores, injectable `gh` runner and Claude Code command
files.

**Spec:** `docs/superpowers/specs/2026-09-30-intake-release-workflow.md` and amended PRODUCT/PRD/TRD.

## Global Constraints

- Disabled by default; preserve existing CLI/hooks/receipt schemas and `decide()` source boundary.
- No model/scheduler/test-wrapper on hook paths; no installed vendor-cache edit or developer paths.
- Corrupt/stale/concurrent state fails visibly. Requests are keyed independently of prose.
- Agent decisions/local-test claims are reported; PR/check observations are measured.
- Release publication is separately off by default; pending DKM review is not bypassed by broad tool policy.
- Every new assertion gets a demonstrated RED and mutation check; complete lint/types/tests precede delivery.

## Review Focus

1. Edited/deleted comments, equal text from different IDs and self-published comments must not loop or erase history.
2. Two sessions modifying the same state must not silently lose requests; failed fetch/publication must remain
   retryable.
3. Empty/failed/malformed checks, stale implementation head and unresolved accepted work must block releases.
4. Reported judgments and local-test prose must never become permission or measured success.
5. A second repo/config and legacy feature-off hooks must work without product-specific imports or new side effects.

## Task 1: Guarded Config and State

**Files:** Create `src/workflow-store.ts`, `src/workflow-store.test.ts`, `src/workflow-types.ts`. **Interfaces:**
`loadWorkflowConfig(root): WorkflowConfig`; `readWorkflow(root, item): WorkflowState`;
`updateWorkflow(root, item, expectedRevision, change): WorkflowState`. The store uses existing `dkmPath` but not private
unrestricted store functions. `WorkflowState` includes version/revision/item/comments/requests/publication metadata.

- [ ] RED: missing config is disabled, malformed config/corrupt state throws without writes, separate repositories share
      nothing, linked worktrees share authority/config and state; stale/concurrent mutations fail.
- [ ] Implement validated TOML through Bun's existing runtime; schema-approved fields only, release disabled default,
      verification commands informational. Add exclusive short write guard and atomic JSON replacement with cleanup.
- [ ] GREEN focused tests and mutate opt-in/guard/identity checks to prove assertions, then restore and rerun.

```ts
expect(loadWorkflowConfig(root).enabled).toBe(false)
expect(() => updateWorkflow(root, item, oldRevision, change)).toThrow()
```

## Task 2: Intake and Verdict Lifecycle

**Files:** Create `src/workflow.ts`, `src/workflow.test.ts`, `src/workflow-github.ts`, transport tests. **Interfaces:**
`syncWorkflow(root, item)`; `recordRequest(root, item, input)`; `renderWorkflow(state)`; `publishWorkflow(root, item)`.
Transport calls existing injectable `runner.run` with exact GitHub argv.

- [ ] RED pagination/failed fetch, per-comment/request identity, stale review/supersession, escaping and no raw-body
      publication. Fingerprint transitions independently of Git head; second publish is a no-op and failure is
      retryable.
- [ ] Implement structured reported records and measured source metadata. Only an explicit record against the current
      comment fingerprint reviews it; preserve request history and surface untriaged/stale/deleted sources.
- [ ] Verify transport fakes reject wrong node-ID REST paths, malformed pages and arbitrary output. Mutation-check core
      assertions and run full baseline compatibility suites.

```ts
expect(renderWorkflow(state)).toContain('| Request | Decision | Why |')
expect(syncWorkflow(root, item).requests[0]?.reviewedFrom).not.toBe(newCommentHash)
```

## Task 3: Measured Delivery and Gated Releases

**Files:** Create `src/workflow-release.ts`, `src/workflow-release.test.ts`; extend workflow transport only.
**Interfaces:** `observeWorkflow(root, item)`; `planRelease(root, item, version)`;
`publishRelease(root, item, version, expectedHead, approved)`. Release parsing rejects unsafe tags; observations bind to
exact PR/head and configured required hosted checks. Permission evaluation receives only constructed operation + policy.

- [ ] RED policy deny/ask, disabled publication, missing explicit approval, dirty/wrong branch, stale head/comment,
      reported-only merged/verified claims, empty/failing/malformed required checks, existing mismatched tag/release and
      retries.
- [ ] Implement pure blockers/notes plus exact-head transport, preserving authority isolation and no automatic merge.
- [ ] Mutation-check each safety blocker. Fake publisher asserts actual `gh` contract and no invocation when blocked.

```ts
expect(planRelease(root, item, '1.1.0').blockers).toContain('Release publication is disabled.')
expect(() => publishRelease(root, item, '1.1.0', staleHead, true)).toThrow()
```

## Task 4: CLI, Command, Local Hook Summary and Version

**Files:** Modify `src/cli.ts`, injection presentation only, plugin/marketplace manifests, CHANGELOG and README; create
command file and CLI/session regressions. Keep existing commands operational.

- [ ] Add explicit workflow init/sync/status/record/render/publish/observe/release-plan/release-publish dispatch.
      Structured records use JSON input; options are validated, not shell-evaluated. Add an operating command for the
      existing lead.
- [ ] Add bounded local opt-in summary to injection; prove no model/network/poller/test/release side effect when off.
- [ ] Prepare branch-local 0.6.0 metadata consistently with version alignment tests; do not create a tag/release.
- [ ] Run complete Bun test/lint/typecheck and fresh source review; fix confirmed findings with RED→GREEN.

## Task 5: TolongLarp Pilot and Review Delivery

**Files:** TolongLarp `.dkm/workflow.toml`, `.gitignore` exception and brief operating guidance. Add a portable dev
launcher only if needed; it accepts an explicit source checkout rather than persisting an absolute path.

- [ ] Create a separate pilot feature branch. Keep existing plugin declaration/policy untouched and publication
      disabled.
- [ ] Sync bound issue1, record every actionable request separately, mark live Codex validation blocked, and publish an
      actual verdict table without fabricating model/native/hosted-check evidence. Exercise another fixture repo/config.
- [ ] Verify both complete suites and real CLI/session paths, distinguish fixtures from live evidence, commit/push both
      branches and open PRs. Request AlaskanTuna review for DKM. Do not merge/publish DKM before approval.

## Rulings

- Explicit owner implementation approval and prior no-question directive replace another internal design approval pause;
  external AlaskanTuna review still gates DKM delivery.
- Optional workflow means records and operating commands, not a generic multi-agent scheduler; existing scope stays
  intact.
- DKM does not execute configured test hints. They remain normal host tool operations so nested CLI execution cannot
  hide a denied operation or manufacture passing evidence.
- Shared own-state write protection is not general project-file locking or agent claiming.
