![Don't Kacau Me](assets/dkm-banner.png)

# Don't Kacau Me

![Bun](https://img.shields.io/badge/Bun-runtime-000000?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Biome](https://img.shields.io/badge/Biome-lint_%26_format-60A5FA?logo=biome&logoColor=white)
![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757)
![MIT licence](https://img.shields.io/badge/licence-MIT-blue)
![Version](https://img.shields.io/badge/version-0.2.0-informational)

Verified work context between developers' agent fleets, and policy-backed answers inside the installer's own sessions.
No human courier. No human decision queue. No manufactured consent.

Contents:

1. [About the project](#about-the-project)
1. [Features](#features)
1. [How it works](#how-it-works)
1. [Architecture](#architecture)
   1. [The hook lifecycle](#the-hook-lifecycle)
   1. [Receipt delivery and tracking](#receipt-delivery-and-tracking)
   1. [The receipt schema](#the-receipt-schema)
   1. [Policy and authority](#policy-and-authority)
   1. [Surviving a usage limit](#surviving-a-usage-limit)
1. [Tech stack](#tech-stack)
1. [Getting started](#getting-started)
   1. [Prerequisites](#prerequisites)
   1. [Installation](#installation)
1. [Configuration](#configuration)
1. [Using DKM: five moments](#using-dkm-five-moments)
   1. [The teammate who pings you at 3am](#the-teammate-who-pings-you-at-3am)
   1. [The contract that changed underneath you](#the-contract-that-changed-underneath-you)
   1. [The three sessions all waiting on you](#the-three-sessions-all-waiting-on-you)
   1. [The morning after](#the-morning-after)
   1. [The thing the agent could not decide](#the-thing-the-agent-could-not-decide)
1. [Repository layout](#repository-layout)
1. [What DKM cannot do](#what-dkm-cannot-do)
1. [Contributing](#contributing)
1. [Licence](#licence)
1. [How work ships](#how-work-ships)

## About the project

DKM is for one developer running two or more Claude Code sessions in git worktrees on the same repository. It also
serves teams of two to five developers who each work that way. Cross-developer propagation expands the single-player
case; it is never a precondition for value.

The problem comes in two parts, and both get worse as the agents get better:

- **Courier duty.** An agent finishes, and its developer summarises that by hand for teammates. The developer then
  pastes teammates' progress back into their own agents. Each hop turns a fact into prose, detaches it from the commit
  where it was true, and makes it no longer checkable.
- **Decision queue.** Sessions pause for the human. Three agents blocking on one person serialise on that person's
  attention, making the person the slowest component in their own workflow. The questions are often lookups or
  applications of rules the human already wrote down rather than exercises of judgement.

The human was the coordination point, not just the decider. Removing that person without replacing coordination creates
divergence faster. DKM therefore ships provenance before autonomy: verified receipts carry work context, and a committed
policy executes decisions the installer has already made.

### The workflow in pictures

The six panels are the whole product in order: three sessions finish overnight, a human hand-carries the facts and loses
their provenance, the `Stop` hook writes a measured receipt instead, a teammate reads it rather than asking, the
committed policy clears the routine prompts, and the migration still waits for a person.

![Six-panel comic: separate worktrees finish at 3am, manual copying loses provenance, the Stop hook writes a measured receipt, a teammate reads it, policy clears routine prompts, and a database migration waits for the sleeping developer](assets/dkm-comic.png)

## Features

- **Verified receipts.** Measured repository state stays separate from session reports and unverified narrative.
- **Three tracking tiers.** Bound, followed and ambient work receive only the detail appropriate to that relationship.
- **Provenance before propagation.** Head SHAs, changed paths and checks travel with the facts they support.
- **Policy-backed autonomy.** Routine prompts can resolve as `allow`; mechanical blast-radius rules preserve `ask` and
  `deny`.
- **Auditable decisions.** Every autonomous answer is logged before it is returned and summarised in the next receipt.
- **Survives a usage limit.** A supervised run waits for the reset the server named and resumes the same session.
- **Pure hooks.** There is no daemon, background poller or model call on the hot path.
- **Small command surface.** Bind work, follow dependencies, report blockers and inspect status without reading raw
  transcripts.

## How it works

The numbered walkthrough follows the six panels above. It shows the user-visible flow first; the hook contracts and data
boundaries come later in [Architecture](#architecture).

### 1. Separate sessions finish

Several Claude Code sessions can complete work in separate git worktrees while their developer is away. Without a shared
record, a teammate can only ask the sleeping developer whether an agent finished.

### 2. Manual courier work loses provenance

Copying one agent's summary into another agent's chat preserves prose, not proof. The commit and checks that made a
claim true fall away as the developer retypes it.

### 3. The repository moves and `Stop` writes a receipt

When the head SHA, blocker set or check state changes, the `Stop` hook measures the repository and upserts one GitHub
comment for the work item. A no-op stop produces no network write and no output.

### 4. The teammate reads the work item

The teammate reads the receipt on the issue instead of messaging the developer. The head SHA, changed paths and check
results make the status useful and re-checkable without the original developer being present.

### 5. Policy clears routine prompts

On `PermissionRequest`, DKM checks the committed `.dkm/policy.toml`. Explicit rules can allow routine work such as
running the formatter, running the tests or writing under `src/`, and each answer is recorded.

### 6. The gate keeps dangerous work human

A database migration trips the mechanical blast-radius table before the allow list. It remains `ask`, so the boring
prompts vanish while the dangerous ones do not.

## Architecture

DKM is a Claude Code hook bundle with no daemon. Every moving part starts on a hook firing, performs a local `git`, file
or `gh` operation, writes any state under `.dkm/`, and exits. Nothing runs between firings, and the hot path never calls
a model.

![DKM architecture: two worktrees feed a bundle of short-lived hooks, which read and write one shared .dkm store, publish receipts to a GitHub work item and reach the human only for what policy did not answer](assets/architecture.svg)

This section stays at the system-narrative level. Hook contracts, data models, schemas and rationale live in
[the technical reference](TRD.md).

### The hook lifecycle

| Hook event          | DKM action                                                                        | Observable result                                           |
| ------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Stop`              | Emit: compare the current state with the last emit                                | Upsert a receipt only when head, blockers or checks changed |
| `SessionStart`      | Ingest: fetch from the repository cursor and drain pending items                  | Inject current context when a session starts                |
| `UserPromptSubmit`  | Ingest the same way, throttled to once every 120 seconds                          | Inject context into an already-running session              |
| `PermissionRequest` | Decide: evaluate policy, append the log, answer `allow` or `deny`, or stay silent | Resolve prior grants without inventing a new one            |

`Stop` means the agent finished a response, not that its work is done. The emit hook therefore produces no receipt when
no tracked state changed.

There is no worktree hook. Claude Code's `WorktreeCreate` and `WorktreeRemove` are **providers** — one is expected to
create the worktree and echo its path, the other to remove it — so a plugin that registered them merely to take notes
would break `claude --worktree` outright. Binding is an explicit command instead.

`PermissionRequest` has no wire form for `ask`. Answering is `allow` or `deny`; saying nothing is what hands the prompt
back to the human, and it is also what DKM emits when its own handler fails.

The injection hooks fetch items since a persisted repository cursor, store them in `.dkm/pending/`, and write them to
stdout so Claude Code adds them to model context. Delivery happens when a session starts or receives a prompt, not the
instant a receipt is published.

`UserPromptSubmit` fires on every turn. Its 120-second throttle prevents every prompt from placing a network call on the
hot path.

### Receipt delivery and tracking

A signal is delivered only at the finest tier that claims it, so nothing arrives twice.

| Tier         | Covers                                                                          | Delivered as                          |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------- |
| **Bound**    | The work item this worktree owns                                                | Full receipt, every field             |
| **Followed** | Work items this session declared a dependency on                                | Contract delta, head SHA, blockers    |
| **Ambient**  | Repository-wide: new issues, new PRs, @mentions, CI failures on the base branch | Headline and URL only, never the body |

Raw commits are not an ambient signal. A commit becomes visible as a head SHA change on a bound or followed item, where
it carries meaning; a repository-wide commit feed is unactionable noise.

### The receipt schema

![Receipt flow: session A finishes a turn, the Stop hook measures the repository and writes a receipt only when something changed, and session B pulls that delta into its context on its next start or prompt](assets/receipt-flow.svg)

One GitHub comment per work item is edited in place, never appended to. Every field has one of three kinds, keeping
measured fact structurally separate from agent narrative.

| Kind           | Source                                  | How to treat                                          |
| -------------- | --------------------------------------- | ----------------------------------------------------- |
| **measured**   | `git` or `gh`                           | May be acted on                                       |
| **reported**   | Asserted by the session about its state | May be displayed and routed, never as repository fact |
| **unverified** | Agent prose                             | May only ever be displayed                            |

The measured fields are `work_item`, `base`, `head`, `changed_paths`, `checks`, `contract_delta`, `decisions`,
`event_id` and `observed_at`. `blockers` is reported, and `narrative` is unverified.

A receipt whose `head` no longer matches the work item's head is stale by definition. A consumer must re-fetch instead
of acting on it. Raw transcripts and unrestricted tool output are never published; the receipt is a fixed allowlisted
schema.

### Policy and authority

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

Installing DKM and writing `.dkm/policy.toml` is the prior human grant. DKM may decide within that committed policy in
the installer's own sessions. A peer session's message is never consent: Claude Code labels its origin, a peer cannot
approve a permission prompt, and an auto-mode relay claiming approval is untrusted input.

There is no code path from an inbound message to a permission grant, and the test suite enforces that boundary.
`PermissionRequest` evaluates rules first-match-wins in this order:

1. Mechanical blast-radius rules.
1. Explicit policy allow rules for paths, tools and commands the installer granted in advance.
1. Default `ask` for anything unmatched.

The blast-radius table is deliberately mechanical, not a model's assessment of importance, because agents are poor at
self-assessing risk. `.dkm/` is on it because the policy is the grant: an agent that can edit the file granting its
authority can widen that authority without anyone deciding to.

| Trip                                                               | Result  |
| ------------------------------------------------------------------ | ------- |
| Deletes data, drops a column, or writes a migration                | `ask`   |
| Egress: posts, publishes, deploys, sends, or opens a network write | `ask`   |
| Spends money                                                       | `ask`   |
| Touches a lockfile, an exported API surface, or `.env`             | `ask`   |
| Touches anything under `.dkm/`, the grant itself                   | `ask`   |
| Writes outside the session's own worktree                          | `deny`  |
| Matches an explicit policy allow rule and trips nothing above      | `allow` |

Every autonomous decision appends to `.dkm/decisions.jsonl` before DKM returns it, not after. The record names the rule,
the inputs and how to reverse it. Its count and summary surface in the receipt, turning an audit into a handful of lines
instead of a replay of the whole turn.

### Surviving a usage limit

A long overnight run used to end the moment the account's usage limit was reached, and everything after that point
simply did not happen. Start it under the supervisor instead:

```bash
bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts revive "work through issue 12" -- --effort high
```

It **waits; it never evades.** When a run stops on a limit, the supervisor reads the reset time the server itself
reported, sleeps until then, and resumes **the same session by id** so the work continues where it was interrupted
rather than starting over. A genuine error stops it instead of being retried forever, and a limit that reports no
session id stops it too, because restarting from the prompt would repeat work already done.

Every pause is appended to `.dkm/revivals.jsonl`, so a night can be reconstructed in the morning.

This is the one part of DKM that is not a hook. It is a foreground process you start instead of starting `claude`, it is
opt-in, and nothing runs in the background when you are not running it.

## Tech stack

| Concern                     | Technology                           | Role                                                                     |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| Plugin host                 | Claude Code hooks and slash commands | Fires the lifecycle and permission events                                |
| Runtime, packages and tests | Bun                                  | Runs TypeScript hooks, installs dev tooling and executes tests           |
| Language                    | TypeScript                           | Strict types with `noUncheckedIndexedAccess` and no emitted build output |
| Repository evidence         | Local `git` and GitHub CLI (`gh`)    | Measures worktree state and maintains issue receipts                     |
| Lint and format             | Biome and Prettier                   | Checks JS, TS and JSON; formats Markdown and YAML                        |
| Type checking               | `tsc --noEmit`                       | Verifies the TypeScript contract without producing artifacts             |
| Change gates                | commitlint, husky and lint-staged    | Enforces conventional commits and checks staged files                    |
| Local state                 | `.dkm/` files and JSONL              | Stores policy, bindings, cursors, pending items and decisions            |

## Getting started

### Prerequisites

- [Claude Code installed and authenticated](https://code.claude.com/docs/en/plugins).
- A git repository with GitHub work items and an authenticated `gh` CLI.
- [Bun](https://bun.sh/) for the plugin runtime and development tooling.

### Installation

1. Clone the repository to a stable local path:

   ```bash
   git clone https://github.com/TolongLabs/dont-kacau-me.git
   ```

1. Install the development tooling. This also wires the husky git hooks:

   ```bash
   bun install
   ```

1. Load the repository as a local Claude Code plugin for the session:

   ```bash
   claude --plugin-dir /absolute/path/to/dont-kacau-me
   ```

   Claude Code reads the manifest from `.claude-plugin/plugin.json`, hook declarations from `hooks/hooks.json`, and
   slash commands from `commands/`. The [`--plugin-dir` workflow](https://code.claude.com/docs/en/plugins) loads a local
   plugin without requiring a marketplace installation.

1. Write and commit `.dkm/policy.toml` in the repository where DKM will run. It is the human grant; do not copy a policy
   whose authority you do not intend to delegate.

1. Bind the worktree to the work item its receipts belong to:

   ```bash
   /dont-kacau-me:dkm-bind 81
   ```

   Claude Code namespaces a plugin's commands under the plugin name, so every DKM command is typed as
   `/dont-kacau-me:<command>`, not `/<command>`.

There is no daemon to start and nothing persistent that can die quietly between hooks.

## Configuration

`.dkm/policy.toml` is the only committed file under `.dkm/`; all other DKM state is git-ignored. Blast-radius rules run
before the file and cannot be overridden from it. Anything unmatched defaults to `ask`.

| Key or section    | Value shape                  | Controls                                  | Safety behavior                                |
| ----------------- | ---------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `version`         | Integer; currently `1`       | Policy schema version                     | Does not grant an action                       |
| `contractGlobs`   | Array of path globs          | Which changed paths form a contract delta | Affects receipt routing, not permission grants |
| `[[allow]].tool`  | Tool name                    | Tool eligible for a prior allow grant     | Still loses to a blast-radius trip             |
| `[[allow]].match` | Optional command string      | Narrows a command-based tool grant        | First matching rule wins                       |
| `[[allow]].paths` | Optional array of path globs | Narrows a write or edit grant             | Cannot authorize outside the session worktree  |

## Using DKM: five moments

The commands are few, and you stop touching them quickly. These are the five moments where the plugin changes a working
day.

### The teammate who pings you at 3am

Someone needs to know whether your agent finished before they can start. Without DKM they message you, and the answer
waits until you wake. With DKM, the work item already carries the head SHA, changed paths and check results.

You did nothing to publish it. The `Stop` hook wrote the receipt when the repository actually moved.

### The contract that changed underneath you

Agent A alters a database schema on PR #81. Agent B is working a declared dependent issue against the old shape in
another worktree and would normally discover the mismatch at merge, after both sides have paid for it.

```bash
/dont-kacau-me:dkm-follow 81
```

When #81 moves, B's next turn opens with the contract delta and the exact SHA where it was observed. B can adapt before
writing the wrong code and re-read the source instead of trusting prose. The two worktrees can be on different
developers' machines, provided both have the repository and an authenticated `gh`.

### The three sessions all waiting on you

Three agents stop on three routine prompts:

- run the formatter
- run the tests
- write a file under `src/`

Each prompt is a context switch, and none represents a decision the developer has not already made many times.

Write those grants once in `.dkm/policy.toml`, and they stop reaching you. A fourth prompt that touches a migration
still waits because blast-radius rules run before the allow list and cannot be switched off from the policy. That
asymmetry is the safety argument: the boring prompts vanish, and the dangerous ones do not.

### The morning after

You slept; the agents did not. Instead of reading three transcripts to reconstruct the night, run:

```bash
/dont-kacau-me:dkm-status
```

Every autonomous decision appears with the rule that produced it. The audit is a handful of lines instead of a replay of
the work. A decision without a log entry is a bug, and the test suite fails on it.

### The thing the agent could not decide

An agent reaches a genuine judgement call: two viable designs, or a requirement nobody wrote down. It should not invent
your intent, and DKM will not let it.

```bash
/dont-kacau-me:dkm-note blocker Two viable shapes for the retry policy; needs a human call
```

The blocker rides the next receipt as **reported**, visibly separate from measured fields. Both the developer and their
teammates can see it without anyone being interrupted.

## Repository layout

```text
.claude-plugin/plugin.json       # plugin manifest
.claude-plugin/marketplace.json  # so the plugin can be installed, not only --plugin-dir'd
.dkm/policy.toml            # the committed policy; all other .dkm/ state is git-ignored
AGENTS.md                   # canonical project instructions
CHANGELOG.md                # what changed, and what is known to be broken
CLAUDE.md                   # points at AGENTS.md
CODE_OF_CONDUCT.md
CONTRIBUTING.md
LICENSE                     # MIT
SECURITY.md                 # private reporting, and what is in scope
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
  assets/                   # banner, comic and diagrams
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
  hooks/                    # one entrypoint per registered hook event, all failing open
test/
  cli.test.ts               # the command surface behind the slash commands
  e2e.test.ts               # hooks invoked as real processes against a temp repository
  fake-gh.ts                # a gh impersonator driven by a fixture file
  plugin.test.ts            # the manifest, hook declarations and command frontmatter
  worktree.test.ts          # state resolves to the main worktree from a linked one
```

## What DKM cannot do

- **No live mid-turn delivery.** A session learns about a receipt when it starts or receives a prompt, because ingest is
  a cursored pull on the injection hooks. A supervised watch or cross-session messaging needs a lifecycle that v1
  deliberately does not have.
- **No cross-machine propagation beyond GitHub.** v1 uses one GitHub comment per work item and the local `.dkm/` store.
  Reaching a machine outside what the repository carries is a v3 concern.
- **No peer-granted consent.** A message from another Claude session cannot approve a permission prompt, and a relayed
  approval claim is untrusted input. DKM contains no code path from an inbound message to a permission grant.
- **No learning precedent store yet.** v1 authority comes from the policy the human wrote and committed, not from
  inference or accumulated precedent.
- **No delivery receipt.** A queued event is removed when a session drains it. Nothing records whether the model
  actually acted on it, so an injected delta that the agent ignored looks identical to one it used.

## Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](../CONTRIBUTING.md) has the setup, the commit convention and
the two testing rules this project will not bend on: pin the harness's contract rather than your own, and mutation-test
every new test before trusting it.

- [`AGENTS.md`](../AGENTS.md) — the canonical instruction set, for humans and agentic tools alike
- [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) — the Contributor Covenant
- [`SECURITY.md`](../SECURITY.md) — report a vulnerability privately, never as a public issue
- [`CHANGELOG.md`](../CHANGELOG.md) — what changed, and what is still known to be broken

## Licence

[MIT](../LICENSE). Copyright 2026 TolongLabs.

## How work ships

`main` is PR-gated, and there are no stray commits.

1. Branch as `<type>/<short-slug>`.
1. Commit as `<type>[scope]: <description>`, imperative, lowercase and without a trailing period. Allowed types are:
   - `feat`
   - `fix`
   - `refactor`
   - `docs`
   - `test`
   - `chore`
   - `style`
   - `perf`
1. Push and open a PR with `gh pr create`.
1. Merge the squashed head, pinning the verified 40-character head SHA and deleting the branch.
