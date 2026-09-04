![Don't Kacau Me](assets/dkm-banner.png)

# Don't Kacau Me

![Bun](https://img.shields.io/badge/Bun-runtime-000000?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Biome](https://img.shields.io/badge/Biome-lint_%26_format-60A5FA?logo=biome&logoColor=white)
![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757)
![MIT licence](https://img.shields.io/badge/licence-MIT-blue)
![Version](https://img.shields.io/badge/version-0.3.0-informational)

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
- **Auditable decisions.** Every policy evaluation is logged before DKM emits its result; the next emitted receipt
  counts decisions since the previous one.
- **Survives a usage limit.** A supervised run computes a wait from the reported reset and resumes the same session.
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

The first bound `Stop` writes a baseline receipt. Later stops update it only when the head SHA, blocker set or check
state changes. An unchanged stop produces no network write and no output.

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

DKM coordinates sessions through Claude Code hooks and has no daemon. Receipt, ingest and permission work begins on a
hook firing and never calls a model. The optional usage-limit supervisor is a foreground CLI process rather than part of
the hook path.

![DKM architecture: two worktrees feed a bundle of short-lived hooks, which read and write one shared .dkm store, publish receipts to a GitHub work item and reach the human only for what policy did not answer](assets/architecture.svg)

This section stays at the system-narrative level. Hook contracts, data models, schemas and rationale live in
[the technical reference](TRD.md).

### The hook lifecycle

| Hook event          | DKM action                                                   | Observable result                                  |
| ------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `Stop`              | Publish a baseline, then compare later tracked state         | Update one receipt only after a tracked delta      |
| `SessionStart`      | Pull repository updates and drain this worktree's queue      | Inject available context when a session starts     |
| `UserPromptSubmit`  | Run the same pull with a rate limit, then drain              | Inject available context on a later prompt         |
| `PermissionRequest` | Evaluate policy, append a record and emit or defer           | Execute a prior grant or leave the prompt to human |
| `SessionEnd`        | Record the session ID, working directory and supplied reason | Leave a diagnostic resume ticket on disk           |

`Stop` means the agent finished a response, not that its work is done. The emit hook therefore produces no receipt when
no tracked state changed.

DKM does not register a worktree lifecycle hook. Binding is an explicit command, so the user chooses the GitHub item a
worktree owns.

When policy does not grant or deny a request, DKM leaves the prompt to the human. A handler failure takes the same human
path.

Delivery is pull-based. A session receives queued context when it starts or submits a prompt, not when another session
publishes a receipt.

### Receipt delivery and tracking

A signal is delivered only at the finest tier that claims it, so nothing arrives twice.

| Tier         | Covers                                                   | Delivered as                                               |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------------- |
| **Bound**    | The work item this worktree owns                         | Receipt summary: SHAs, contract paths, checks and blockers |
| **Followed** | Work items this session declared a dependency on         | The same receipt summary, labelled `followed`              |
| **Ambient**  | Other issues and PRs updated since the repository cursor | Headline and URL                                           |

The current GitHub query returns updated issues and PRs. DKM discards body fields before it builds a pending event; it
does not implement separate @mention or base-branch CI feeds. Raw commits are not an ambient signal.

### The receipt schema

![Receipt flow: session A finishes a turn, the Stop hook measures the repository and writes a receipt only when something changed, and session B pulls that delta into its context on its next start or prompt](assets/receipt-flow.svg)

One GitHub comment per work item is edited in place, never appended to. Receipt content has three trust levels, keeping
repository evidence structurally separate from agent narrative.

| Kind           | Source                                  | How to treat                                          |
| -------------- | --------------------------------------- | ----------------------------------------------------- |
| **measured**   | `git` or `gh`                           | May be acted on                                       |
| **reported**   | Asserted by the session about its state | May be displayed and routed, never as repository fact |
| **unverified** | Agent prose                             | May only ever be displayed                            |

The receipt carries GitHub item identity, a git range, changed paths, check results, contract paths, decision counts,
reported blockers, narrative and an observation time. DKM does not read raw transcripts or tool output into a receipt;
only a note explicitly recorded through the CLI becomes narrative.

Every receipt carries the head SHA at measurement time, but DKM does not compare it with the current remote head before
injection. The injected warning tells the session to re-read before acting if the head has moved.

### Policy and authority

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

Installing DKM and writing `.dkm/policy.toml` is the prior human grant. DKM may decide within that committed policy in
the installer's own sessions. `src/decide.ts` receives only the current permission input and parsed policy; it does not
import the pending-event store or GitHub client.

`PermissionRequest` evaluates rules in this order:

1. Mechanical blast-radius rules.
1. Explicit policy allow rules for paths, tools and commands the installer granted in advance.
1. Default `ask` for anything unmatched.

The blast-radius table is deliberately mechanical, not a model's assessment of importance, because agents are poor at
self-assessing risk. `.dkm/` is on it because the policy is the grant: an agent that can edit the file granting its
authority can widen that authority without anyone deciding to.

| Recognised input                                                            | Result  |
| --------------------------------------------------------------------------- | ------- |
| A path outside the session worktree                                         | `deny`  |
| Recursive forced removal, destructive SQL, or a `migrations`/`drizzle` path | `ask`   |
| Recognised network, push, deployment, publication or release commands       | `ask`   |
| A package manifest, supported lockfile, `.env` file or path under `.dkm/`   | `ask`   |
| The first matching policy allow rule, after no blast-radius match           | `allow` |
| Anything else                                                               | `ask`   |

Every valid permission evaluation appends to `.dkm/decisions.jsonl` before DKM emits its result. The status command
shows the total record count and the five most recent records; a later receipt counts decisions since the previous emit.

### Surviving a usage limit

A long overnight run used to end the moment the account's usage limit was reached, and everything after that point
simply did not happen. Start it under the supervisor instead:

From the plugin clone, run:

```bash
bun src/cli.ts revive "work through issue 12" -- --effort high
```

When a run stops on a limit, the supervisor reads the reported reset time. A reset up to six hours away gets a 30-second
cushion; a later reset is rechecked after six hours, and a missing or past time uses capped exponential backoff. It then
resumes **the same session by ID** rather than restarting the original prompt.

A genuine error stops instead of being retried forever. A limit that reports no session ID also stops because replaying
the prompt could repeat work already done. No code path changes credentials or account.

Every wait is appended to `.dkm/revivals.jsonl`; completion and failure are recorded there too.

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
| Change tooling              | commitlint, husky and lint-staged    | Installed, but no project commit-hook scripts currently invoke it        |
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

1. Install the development tooling. The package prepare script also runs Husky, although this repository currently has
   no project `pre-commit` or `commit-msg` hook script:

   ```bash
   bun install
   ```

1. Install it as a plugin. From the clone, the trailing slash matters — a bare `.` is rejected:

   ```bash
   claude plugin marketplace add ./
   claude plugin install dont-kacau-me@tolonglabs
   ```

   To try it for one session without installing anything, load the directory instead:

   ```bash
   claude --plugin-dir "$(pwd)"
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

| Key or section    | Value shape                  | Controls                                         | Safety behavior                                   |
| ----------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| `version`         | Integer by convention        | Present in the committed file; parser ignores it | Loaded policy remains version 1                   |
| `contractGlobs`   | Array of path globs          | Which changed paths form `contractDelta`         | Changes receipt content, not permission decisions |
| `[[allow]].tool`  | Tool name                    | Tool eligible for a prior allow grant            | Still loses to a blast-radius trip                |
| `[[allow]].match` | Optional substring           | Narrows the first command, path or URL input     | First matching allow rule wins                    |
| `[[allow]].paths` | Optional array of path globs | Requires at least one candidate path to match    | An outside-worktree candidate still denies        |

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

The output gives the total decision count and the five most recent records, including each record's rule and input
summary. The full append-only history remains in `.dkm/decisions.jsonl`.

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
.dkm/policy.toml                 # the committed policy; all other .dkm/ state is git-ignored
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
- **No automatic stale-head check.** A receipt carries the head observed by its publisher, but ingest does not compare
  that SHA with the work item's current remote head before rendering it.
- **No enforced hop budget.** Pending events carry `rootId` and `hops`, but the current code only writes and validates
  those fields. It never increments or rejects on them.
- **Narrow ambient feed.** Ambient ingest sees issues and PRs returned by the updated-items query. It has no separate
  @mention or base-branch CI source.

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
