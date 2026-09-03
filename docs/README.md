![Don't Kacau Me](assets/dkm-banner.png)

# Don't Kacau Me

Don't Kacau Me (DKM) is a Claude Code plugin that carries verified work context between the agent fleets of different
developers, and decides on its installer's behalf inside their own sessions, so that no human has to act as a courier or
a decision queue. It is built for one developer running several Claude Code sessions in git worktrees on the same
repository, and for small teams of two to five who already work the same way.

![Six-panel comic: three agents interrupt a developer all night, DKM ships receipts and waits at the migration gate, the developer finally sleeps](assets/dkm-comic.png)

## Table of contents

1. [About the project](#about-the-project)
1. [The rule that governs everything](#the-rule-that-governs-everything)
1. [How it works](#how-it-works)
1. [Tracking tiers](#tracking-tiers)
1. [The receipt](#the-receipt)
1. [The decision engine](#the-decision-engine)
1. [Getting started](#getting-started)
1. [Using it: five moments](#using-it-five-moments)
   1. [The teammate who pings you at 3am](#the-teammate-who-pings-you-at-3am)
   1. [The contract that changed underneath you](#the-contract-that-changed-underneath-you)
   1. [The three sessions all waiting on you](#the-three-sessions-all-waiting-on-you)
   1. [The morning after](#the-morning-after)
   1. [The thing the agent could not decide](#the-thing-the-agent-could-not-decide)
1. [Repository layout](#repository-layout)
1. [What DKM cannot do](#what-dkm-cannot-do)
1. [How work ships](#how-work-ships)

## About the project

DKM is for one developer running two or more Claude Code sessions in git worktrees on the same repository, and for a
team of two to five developers who each work that way. Cross-developer propagation is the expansion of the single-player
case, never its precondition.

The problem has two parts, and both scale with how well the agents work:

- **Courier duty.** An agent finishes, and its developer summarises that by hand for teammates. The developer then
  pastes teammates' progress back into their own agents. Every hop loses provenance. By the time a fact reaches a second
  agent it is:

  - prose
  - detached from the commit it was true at
  - no longer checkable

- **Decision queue.** Sessions pause for the human. Three agents blocking on one person serialise on that person's
  attention, and the person becomes the slowest component in their own workflow. Many blocking questions are lookups or
  applications of a rule the human already wrote down, not exercises of judgement.

The unifying observation is that the human was the coordination point, not just the decider. Removing them without
replacing coordination produces divergence, faster. That is why DKM ships provenance before it ships autonomy.

## The rule that governs everything

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

Installing DKM and writing `.dkm/policy.toml` is the prior human grant. Deciding autonomously inside the installer's own
sessions, within the policy they wrote, is legitimate and is the product.

A peer session's message is never that grant. Claude Code labels a peer message as coming from another Claude session, a
peer cannot approve a permission prompt, and in auto mode a relayed approval claim is treated as untrusted input. DKM
contains no code path from an inbound message to a permission grant, and a test in the suite enforces this.

## How it works

DKM is a Claude Code hook bundle with no daemon. Every moving part is a hook process that starts, does one local `git`,
file or `gh` operation, writes to `.dkm/`, and exits. The hot path must stay inside the hook timeout, so the design
never calls a model.

```text
worktree A ──┐                       ┌── receipt (one GitHub comment per work item)
             ├── hooks ─── .dkm/ ────┤
worktree B ──┘                       └── decisions.jsonl

Stop              ──► emit    : compute the delta; upsert only if head, blockers or checks changed
SessionStart      ──► ingest  : fetch since the cursor, drain pending into stdout
UserPromptSubmit  ──► inject  : same, for an already-running session
PermissionRequest ──► decide  : evaluate the policy, log, return allow / deny / ask
WorktreeCreate    ──► bind    : resolve the work item and record the binding
WorktreeRemove    ──► release : remove the binding
```

- **Emit on `Stop`.** The hook compares the current state to the last emit. A receipt is written only when the head SHA,
  the blocker set or the check state changed. `Stop` means the agent finished a response, not that the work is done, so
  a no-op produces no network write and no output.
- **Ingest on `SessionStart` and `UserPromptSubmit`.** These injection hooks fetch new items since the persisted
  repository cursor, store them in `.dkm/pending/`, then write them to stdout so the harness adds them to the model's
  context. A session learns about a receipt when it starts or receives a prompt, not the instant it is published.
  `UserPromptSubmit` fires on every turn, so its fetch is throttled to once every 120 seconds; without that, every
  prompt you typed would put a network call on the hot path.
- **Decide on `PermissionRequest`.** This hook fires when the harness would otherwise interrupt the human. DKM evaluates
  the installer's `.dkm/policy.toml`, appends a record to `.dkm/decisions.jsonl` before returning, and answers `allow`,
  `deny` or `ask`.

## Tracking tiers

A signal is only delivered at the finest tier that claims it, so nothing arrives twice.

| Tier         | Covers                                                                          | Delivered as                          |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------- |
| **Bound**    | The work item this worktree owns                                                | Full receipt, every field             |
| **Followed** | Work items this session declared a dependency on                                | Contract delta, head SHA, blockers    |
| **Ambient**  | Repository-wide: new issues, new PRs, @mentions, CI failures on the base branch | Headline and URL only, never the body |

Raw commits are not an ambient signal. A commit becomes visible as a head SHA change on a bound or followed item, which
is the only place it carries meaning. A repository-wide commit feed is noise with nothing actionable in it.

## The receipt

One GitHub comment per work item is edited in place, never appended to. Every field is one of three kinds, so measured
fact and agent narrative are structurally separated:

| Kind           | Source                                  | How to treat                                    |
| -------------- | --------------------------------------- | ----------------------------------------------- |
| **measured**   | `git` or `gh`                           | May be acted on                                 |
| **reported**   | Asserted by the session about its state | May be displayed and routed, never as repo fact |
| **unverified** | Agent prose                             | May only ever be displayed                      |

The measured fields are `work_item`, `base`, `head`, `changed_paths`, `checks`, `contract_delta`, `decisions`,
`event_id` and `observed_at`; `blockers` is reported; and `narrative` is unverified. A receipt whose `head` no longer
matches the work item's head is stale by definition, and a consumer must re-fetch rather than act on it.

This separation matters because it stops agent prose from being treated as repository fact, and it keeps the published
receipt to a fixed allowlisted schema. Raw transcripts and tool output are never published.

## The decision engine

`PermissionRequest` fires when the harness would otherwise interrupt the human. DKM answers from `.dkm/policy.toml`,
which the installer wrote and committed.

Evaluation order is first-match-wins, and the default is always `ask`:

1. **Blast-radius deny rules.** Mechanically checkable, no judgement.
1. **Explicit policy allow rules.** Paths, tools and commands the installer granted in advance.
1. **Default `ask`.** Anything unmatched reaches the human, exactly as today.

The blast-radius table is the safety property. It is deliberately mechanical rather than a model's assessment of
importance, because agents are poor at self-assessing risk.

| Trip                                                               | Result  |
| ------------------------------------------------------------------ | ------- |
| Deletes data, drops a column, or writes a migration                | `ask`   |
| Egress: posts, publishes, deploys, sends, or opens a network write | `ask`   |
| Spends money                                                       | `ask`   |
| Touches a lockfile, an exported API surface, or `.env`             | `ask`   |
| Writes outside the session's own worktree                          | `deny`  |
| Matches an explicit policy allow rule and trips nothing above      | `allow` |

Every autonomous decision appends a record to `.dkm/decisions.jsonl` before the decision is returned, not after. The
record names the rule, the inputs, and how to reverse it. The count and summary surface in the receipt, so the audit is
a handful of lines rather than a replay of the whole turn.

## Getting started

1. **Install the plugin.** DKM ships as a Claude Code plugin: a manifest at `.claude-plugin/plugin.json`, hook
   declarations in `hooks/hooks.json`, and slash commands in `commands/`. There is no daemon, so there is nothing to
   start and nothing that can die quietly.

1. **Install the dev tooling.** `bun install`, which also wires the husky git hooks.

1. **Write your policy.** `.dkm/policy.toml` is the one file under `.dkm/` that is committed, because it is the human
   grant that makes autonomy legitimate. It holds `version`, `contractGlobs` and `[[allow]]` entries. The blast-radius
   rules run first and cannot be overridden from it; anything unmatched falls through to `ask`.

## Using it: five moments

The commands are few and you stop touching them quickly. What follows is what the plugin actually changes about a
working day.

### The teammate who pings you at 3am

Someone needs to know whether your agent finished before they can start. Without DKM they message you, and the answer
waits until you wake up. With DKM the receipt is already on the work item, carrying the head SHA, the changed paths and
the check results — so they read it instead of asking you.

You did nothing to make that happen. The `Stop` hook wrote it when the repository actually moved.

### The contract that changed underneath you

Agent A alters a database schema on PR #81. Agent B, in another worktree, is building against the old shape and does not
know. Normally you discover this at merge, having paid for both sides of the mistake.

```bash
/dkm-follow 81
```

Now when #81 moves, B's next turn opens with the contract delta and the exact SHA it was observed at. B adapts before
writing the wrong code, and the SHA is there so it can re-read rather than trust prose.

### The three sessions all waiting on you

Three agents, three permission prompts:

- run the formatter
- run the tests
- write a file under `src/`

Each one is a context switch, and none of them is a decision you have not already made a hundred times.

Write those down once in `.dkm/policy.toml` and they stop reaching you. The fourth prompt — the one that touches a
migration — still waits, because blast-radius rules are evaluated before your allow list and cannot be switched off from
it. That asymmetry is the entire safety argument: the boring prompts vanish and the dangerous ones do not.

### The morning after

You slept. The agents did not. Instead of reading three transcripts to reconstruct what happened:

```bash
/dkm-status
```

Every autonomous decision is there with the rule that produced it, so an audit is reading a handful of lines rather than
re-litigating the work. A decision without a log entry is a bug, and the test suite fails on it.

### The thing the agent could not decide

An agent hits a genuine judgement call — which of two designs, or a requirement nobody wrote down. It should not invent
your intent, and DKM will not let it.

```bash
/dkm-note blocker Two viable shapes for the retry policy; needs a human call
```

The blocker rides the next receipt as **reported**, visibly separate from the measured fields, where both you and your
teammates can see it without anyone being interrupted.

## Repository layout

```text
.claude-plugin/plugin.json  # plugin manifest
.dkm/policy.toml            # the committed policy; all other .dkm/ state is git-ignored
AGENTS.md                   # canonical project instructions
CLAUDE.md                   # points at AGENTS.md
biome.json                  # lint and format for JS, TS, JSON
commitlint.config.js
package.json
tsconfig.json
commands/                   # slash commands
  dkm-bind.md
  dkm-follow.md
  dkm-note.md
  dkm-status.md
hooks/hooks.json            # hook declarations, resolved against ${CLAUDE_PLUGIN_ROOT}
docs/
  README.md                 # this file
  PRODUCT.md                # who and why
  PRD.md                    # what
  TRD.md                    # how; canonical on technical detail
  markdown-style.md         # the Markdown style guide
  assets/                   # banner and comic
  superpowers/specs/        # the original design spec
src/
  cli.ts                    # bind, follow, note, blocker, status
  decide.ts                 # the blast-radius rule table
  git.ts                    # measured fields from the local repository
  github.ts                 # the gh wrapper, fail-soft on every read
  policy.ts                 # the TOML policy reader
  receipt.ts                # render, parse, fingerprint
  store.ts                  # everything under .dkm/
  types.ts                  # the shared contract
  hooks/                    # one entrypoint per hook event, all failing open
test/
  e2e.test.ts               # hooks invoked as real processes against a temp repository
  fake-gh.ts                # a gh impersonator driven by a fixture file
```

## What DKM cannot do

- **No live mid-turn delivery.** A session learns about a receipt when it starts or receives a prompt, because ingest is
  a cursored pull on the injection hooks. A supervised watch or cross-session messaging would need a lifecycle that v1
  deliberately does not have.

- **No cross-machine propagation beyond GitHub.** v1 uses one GitHub comment per work item and the local `.dkm/` store.
  Reaching a machine outside what the repository carries is a v3 concern.

- **No peer-granted consent.** A message from another Claude session cannot approve a permission prompt, and a relayed
  approval claim is treated as untrusted input. DKM contains no code path from an inbound message to a permission grant.

- **No learning precedent store yet.** v1's authority comes from the policy the human wrote and committed, not from
  inference or accumulated precedent.

## How work ships

`main` is PR-gated and there are no stray commits.

1. **Branch** as `<type>/<short-slug>`.
1. **Commit** as `<type>[scope]: <description>`, imperative, lowercase, no trailing period. Types:
   - `feat`
   - `fix`
   - `refactor`
   - `docs`
   - `test`
   - `chore`
   - `style`
   - `perf`
1. **Push and open a PR** with `gh pr create`.
1. **Merge** the squashed head, pinning the verified 40-character head SHA and deleting the branch.
