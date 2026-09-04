![Don't Kacau Me](assets/dkm-banner.png)

# Don't Kacau Me

![Bun](https://img.shields.io/badge/Bun-runtime-000000?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Biome](https://img.shields.io/badge/Biome-lint_%26_format-60A5FA?logo=biome&logoColor=white)
![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757)
![MIT licence](https://img.shields.io/badge/licence-MIT-blue)
![Version](https://img.shields.io/badge/version-0.3.0-informational)

Verified work context between developers' agent fleets, with policy-backed answers inside the installer's own sessions.

> No human courier. No human decision queue. No manufactured consent.

## Table of contents

<details>
  <summary>Expand</summary>
  <ol>
    <li><a href="#about-the-project">About the project</a></li>
    <li><a href="#features">Features</a></li>
    <li><a href="#how-it-works">How it works</a></li>
    <li>
      <a href="#architecture">Architecture</a>
      <ul>
        <li><a href="#the-hook-lifecycle">The hook lifecycle</a></li>
        <li><a href="#receipt-delivery-and-tracking">Receipt delivery and tracking</a></li>
        <li><a href="#the-receipt-schema">The receipt schema</a></li>
        <li><a href="#policy-and-authority">Policy and authority</a></li>
        <li><a href="#surviving-a-usage-limit">Surviving a usage limit</a></li>
      </ul>
    </li>
    <li><a href="#tech-stack">Tech stack</a></li>
    <li><a href="#getting-started">Getting started</a></li>
    <li><a href="#configuration">Configuration</a></li>
    <li><a href="#using-dkm-five-moments">Using DKM: five moments</a></li>
    <li><a href="#repository-layout">Repository layout</a></li>
    <li><a href="#what-dkm-cannot-do">What DKM cannot do</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#licence">Licence</a></li>
    <li><a href="#how-work-ships">How work ships</a></li>
  </ol>
</details>

## About the project

DKM is for developers running two or more Claude Code sessions in git worktrees on the same repository.

| User                                             | Value                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- |
| One developer with several sessions              | Useful without anyone else adopting DKM                    |
| Teams of two to five developers working this way | Adds cross-developer propagation to the single-player case |

It removes two coordination costs:

| Cost               | Without DKM                                                                                                                      | With DKM                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Courier duty**   | Developers summarise agent work for teammates, then paste progress back; every hop loses its commit, provenance and checkability | Verified receipts carry checkable work context                 |
| **Decision queue** | Routine lookups and applications of written rules serialize sessions on one person's attention                                   | Committed policy executes decisions the installer already made |

The human was the coordination point, not only the decider. DKM ships provenance before autonomy so removing that
coordination point does not create faster divergence.

### The workflow in pictures

The six panels show the product in order:

1. Three sessions finish overnight.
1. A human hand-carries the facts and loses their provenance.
1. The `Stop` hook writes a measured receipt instead.
1. A teammate reads it rather than asking.
1. The committed policy clears routine prompts.
1. The migration still waits for a person.

![Six-panel comic: separate worktrees finish at 3am, manual copying loses provenance, the Stop hook writes a measured receipt, a teammate reads it, policy clears routine prompts, and a database migration waits for the sleeping developer](assets/dkm-comic.png)

## Features

| Feature                           | What it does                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Verified receipts**             | Keeps measured repository state separate from session reports and unverified narrative                    |
| **Three tracking tiers**          | Gives every queued item one per-recipient relationship label                                              |
| **Provenance before propagation** | Carries receipt evidence with the state it supports                                                       |
| **Policy-backed autonomy**        | Allows routine prompts while blast-radius rules preserve the human path and deny outside-worktree access  |
| **Auditable decisions**           | Logs the normal permission path before emitting; the next receipt counts decisions since the previous one |
| **Usage-limit survival**          | Computes a supervised wait from the reported reset, then resumes the same session                         |
| **Hook-driven coordination**      | Uses no daemon, background poller or model call on the hot path                                           |
| **Small command surface**         | Covers work-item coordination and decision audit with a few commands                                      |

## How it works

The user-visible flow has six steps; [Architecture](#architecture) covers the data boundaries behind them.

### 1. Finish — separate sessions complete work

Several Claude Code sessions can complete work in separate git worktrees while their developer is away. Without a shared
record, a teammate can only ask the sleeping developer whether an agent finished.

### 2. Copy — manual handoffs lose provenance

Copying one agent's summary into another agent's chat preserves prose, not proof. The commit and checks that made a
claim true fall away as the developer retypes it.

### 3. Measure — `Stop` writes tracked changes

The first bound `Stop` writes a baseline receipt. Later stops update it only when the head SHA, blocker set or check
state changes. An unchanged stop produces no network write and no output.

### 4. Read — open the work-item evidence

The teammate reads the receipt on the issue instead of messaging the developer. It carries:

- the head SHA
- changed paths
- check results

That evidence makes the status useful and re-checkable without the original developer being present.

### 5. Decide — clear routine prompts

On `PermissionRequest`, DKM checks the committed `.dkm/policy.toml`. Explicit rules can allow:

- running the formatter
- running the tests
- writing under `src/`

Each evaluated answer is recorded on the normal handler path.

### 6. Escalate — keep dangerous work human

A database migration path trips the mechanical blast-radius table before the allow list. It remains `ask`, so routine
prompts can disappear while that one still reaches the human.

## Architecture

DKM coordinates sessions through Claude Code hooks and has no daemon. Hook-driven receipt, ingest and permission work
never calls a model; the optional usage-limit supervisor is a foreground CLI process.

![DKM architecture: two worktrees feed short-lived hooks, shared DKM state publishes a receipt to a GitHub work item, and policy leaves unmatched prompts to the human](assets/architecture.svg)

This section stays at the system-narrative level. Implementation contracts and rationale live in
[the technical reference](TRD.md).

### The hook lifecycle

| Hook event          | DKM action                                              | Observable result                                  |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `Stop`              | Publish a baseline, then compare later tracked state    | Update one receipt only after a tracked delta      |
| `SessionStart`      | Pull repository updates and drain this worktree's queue | Inject available context when a session starts     |
| `UserPromptSubmit`  | Run the same pull with a rate limit, then drain         | Inject available context on a later prompt         |
| `PermissionRequest` | Evaluate policy, append a record and emit or defer      | Execute a prior grant or leave the prompt to human |
| `SessionEnd`        | Record the supplied session details                     | Leave a diagnostic resume ticket on disk           |

- `Stop` ends a response, not the work; after the baseline, unchanged tracked state produces no receipt.
- DKM registers no worktree lifecycle hook. Explicit binding lets the user choose the GitHub item a worktree owns.
- An unmatched permission or handler failure leaves the prompt to the human.
- Pull-based delivery injects queued context on session start or prompt submission, not when another session publishes.

### Receipt delivery and tracking

A signal is queued only at the finest tier that claims it for one recipient and ingest.

| Tier         | Covers                                                   | Delivered as                                               |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------------- |
| **Bound**    | The work item this worktree owns                         | Receipt summary: SHAs, contract paths, checks and blockers |
| **Followed** | Work items this session declared a dependency on         | The same receipt summary, labelled `followed`              |
| **Ambient**  | Other issues and PRs updated since the repository cursor | Headline and URL                                           |

- The current GitHub query returns updated issues and PRs; raw commits are not an ambient signal.
- DKM discards body fields before building a pending event.
- Separate @mention and base-branch CI feeds are not implemented.

### The receipt schema

![Receipt flow: session A finishes a turn, the Stop hook writes a baseline or tracked delta, and session B pulls that receipt context on its next start or prompt](assets/receipt-flow.svg)

DKM edits one GitHub comment per work item in place instead of appending comments. Three trust levels keep repository
evidence separate from agent narrative.

| Kind           | Source                                  | How to treat                                          |
| -------------- | --------------------------------------- | ----------------------------------------------------- |
| **Measured**   | `git`, `gh` or counted local state      | May be acted on                                       |
| **Reported**   | Asserted by the session about its state | May be displayed and routed, never as repository fact |
| **Unverified** | Agent prose                             | May only ever be displayed                            |

The receipt carries:

- GitHub item identity and a git range
- changed paths, check results and contract paths
- decision counts
- reported blockers
- unverified narrative
- an observation time

DKM does not read raw transcripts or tool output into a receipt. Only a note explicitly recorded through the CLI becomes
narrative.

Every receipt carries the head SHA at measurement time, but DKM does not compare it with the current remote head before
injection. The injected warning tells the session to re-read before acting if the head has moved.

### Policy and authority

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

Installing DKM and writing `.dkm/policy.toml` is the prior human grant. DKM may decide within that committed policy in
the installer's own sessions. `src/decide.ts` receives only the current permission input and parsed policy; it imports
neither the pending-event store nor the GitHub client.

`PermissionRequest` evaluates:

1. Mechanical blast-radius rules.
1. Explicit policy allow rules for paths, tools and commands granted in advance.
1. The default human path for anything unmatched: `ask`.

The table is mechanical rather than model-assessed because agents are poor at self-assessing risk. `.dkm/` is protected
because an agent that can edit its grant can widen that authority without anyone deciding to.

| Recognised input                                                           | Result  |
| -------------------------------------------------------------------------- | ------- |
| A path outside the session worktree                                        | `deny`  |
| Recursive forced removal, destructive SQL or a `migrations`/`drizzle` path | `ask`   |
| Recognised network, push, deployment, publication or release commands      | `ask`   |
| A package manifest, supported lockfile, `.env` file or path under `.dkm/`  | `ask`   |
| The first matching policy allow rule, after no blast-radius match          | `allow` |
| Anything else                                                              | `ask`   |

On its normal path, every permission evaluation appends to `.dkm/decisions.jsonl` before DKM emits. The status command
shows the total valid-record count and the five most recent records; a later receipt counts decisions since the prior
successful emit for that work item.

### Surviving a usage limit

A long run can end at the account's usage limit. From the plugin clone, start it under the supervisor instead:

```bash
bun src/cli.ts revive "work through issue 12" -- --effort high
```

On a recognised limit, the supervisor reads the reported reset and resumes the same session by ID instead of replaying
the original prompt.

| Situation                      | Supervisor action                                  |
| ------------------------------ | -------------------------------------------------- |
| Reset up to six hours away     | Wait until reset with a 30-second cushion          |
| Reset more than six hours away | Recheck after six hours                            |
| Missing or past reset time     | Use capped exponential backoff                     |
| Genuine error                  | Stop                                               |
| Limit without a session ID     | Stop because replaying could repeat completed work |

Every wait, completion and failure is recorded in `.dkm/revivals.jsonl`. No code path changes credentials or account.

> **Optional — supervisor.** This opt-in process runs only in the foreground; nothing remains active after it exits.

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

Install DKM from a stable clone, commit the authority policy, then bind a worktree to its GitHub item.

### Prerequisites

- [Claude Code installed and authenticated](https://code.claude.com/docs/en/plugins).
- A git repository with GitHub work items and an authenticated `gh` CLI.
- [Bun](https://bun.sh/) for the plugin runtime and development tooling.

### 1. Clone — choose a stable path

```bash
git clone https://github.com/TolongLabs/dont-kacau-me.git
```

### 2. Prepare — install the tooling

The package prepare script runs Husky, although this repository has no project `pre-commit` or `commit-msg` hook script.

```bash
bun install
```

### 3. Install — add the plugin

From the clone, add its marketplace and install DKM. The trailing slash matters because a bare `.` is rejected.

```bash
claude plugin marketplace add ./
claude plugin install dont-kacau-me@tolonglabs
```

> **Optional — one-session trial.** Load the clone without a marketplace installation:

```bash
claude --plugin-dir "$(pwd)"
```

| Claude Code source | Path                         |
| ------------------ | ---------------------------- |
| Manifest           | `.claude-plugin/plugin.json` |
| Hook declarations  | `hooks/hooks.json`           |
| Slash commands     | `commands/`                  |

The [`--plugin-dir` workflow](https://code.claude.com/docs/en/plugins) loads the local plugin without installing it.

### 4. Grant — write the policy

Write and commit `.dkm/policy.toml` in the repository where DKM will run. It is the human grant; do not copy authority
you do not intend to delegate.

### 5. Bind — name the receipt's work item

```bash
/dont-kacau-me:dkm-bind 81
```

Claude Code namespaces DKM commands as `/dont-kacau-me:<command>`. There is no daemon to start.

## Configuration

`.dkm/policy.toml` is the only committed file under `.dkm/`; all other DKM state is git-ignored. Blast-radius rules run
before the file and cannot be overridden from it. Anything unmatched defaults to the human path.

| Key or section    | Value shape                  | Controls                                      | Safety behavior                                   |
| ----------------- | ---------------------------- | --------------------------------------------- | ------------------------------------------------- |
| `version`         | Integer by convention        | Present in the file; the parser ignores it    | Loaded policy remains version 1                   |
| `contractGlobs`   | Array of path globs          | Which changed paths form `contractDelta`      | Changes receipt content, not permission decisions |
| `[[allow]].tool`  | Tool name                    | Tool eligible for a prior allow grant         | Still loses to a blast-radius trip                |
| `[[allow]].match` | Optional substring           | Narrows the first command, path or URL input  | First matching allow rule wins                    |
| `[[allow]].paths` | Optional array of path globs | Requires at least one candidate path to match | An outside-worktree candidate still denies        |

## Using DKM: five moments

The commands are few, and you stop touching them quickly. These are the five moments where the plugin changes a working
day.

### The teammate who pings you at 3am

Someone needs to know whether your agent finished before they can start. Without DKM they message you, and the answer
waits until you wake. With DKM, the work item already carries receipt evidence.

You did nothing to publish it. The `Stop` hook wrote the receipt after the worktree was bound.

### The contract that changed underneath you

Agent A alters a database schema on PR #81. Agent B is working a declared dependent issue against the old shape in
another worktree and would normally discover the mismatch at merge, after both sides have paid for it.

```bash
/dont-kacau-me:dkm-follow 81
```

When #81 appears in ingest and receipt enrichment stays within budget, B's next turn opens with its contract delta and
observed SHA. B can re-read the source rather than trusting prose. The worktrees may be on different machines when each
has the repository and an authenticated `gh`.

### The three sessions all waiting on you

Three agents stop on routine prompts:

- run the formatter
- run the tests
- write a file under `src/`

Write those grants once in `.dkm/policy.toml`, and they stop reaching you. A prompt with a recognized migration path
still waits because blast-radius rules run before the allow list and cannot be switched off from policy.

### The morning after

Instead of reading three transcripts to reconstruct the night, run:

```bash
/dont-kacau-me:dkm-status
```

The output gives the total decision count and the five most recent records, including each record's rule and input
summary. The full append-only history remains in `.dkm/decisions.jsonl`.

### The thing the agent could not decide

An agent reaches a genuine judgement call that policy does not cover. Record a reported blocker:

```bash
/dont-kacau-me:dkm-note blocker Two viable shapes for the retry policy; needs a human call
```

The blocker rides the next receipt that the emit predicate publishes. Its reported status remains separate from measured
fields.

## Repository layout

```text
.claude-plugin/plugin.json       # plugin manifest
.claude-plugin/marketplace.json  # marketplace installation metadata
.dkm/policy.toml                 # committed policy; other .dkm state is ignored
AGENTS.md                        # canonical project instructions
CHANGELOG.md                     # release history and known limitations
CLAUDE.md                        # points at AGENTS.md
CODE_OF_CONDUCT.md
CONTRIBUTING.md
LICENSE                          # MIT
SECURITY.md                      # private reporting and scope
biome.json                       # lint and format for JS, TS and JSON
commitlint.config.js
package.json
tsconfig.json
commands/                        # slash commands
  dkm-bind.md
  dkm-follow.md
  dkm-note.md
  dkm-status.md
hooks/hooks.json                 # hook declarations
docs/
  README.md                      # this file
  PRODUCT.md                     # who and why
  PRD.md                         # what
  TRD.md                         # canonical implementation detail
  markdown-style.md              # Markdown style guide
  assets/                        # banner, comic and diagrams
  superpowers/specs/             # historical design record
src/
  cli.ts                         # command implementation and supervisor entry
  decide.ts                      # blast-radius and allow evaluation
  git.ts                         # repository measurements
  github.ts                      # gh wrapper
  policy.ts                      # restricted policy parser
  receipt.ts                     # receipt render, parse and fingerprint
  revive-run.ts                  # supervised resume loop
  revive.ts                      # limit classification and wait calculation
  store.ts                       # shared .dkm state
  types.ts                       # shared contracts
  hooks/                         # registered hook entrypoints
test/
  cli.test.ts                    # command integration tests
  e2e.test.ts                    # hook child-process tests
  fake-gh.ts                     # fixture-backed gh impersonator
  plugin.test.ts                 # packaging and command tests
  worktree.test.ts               # linked-worktree state tests
```

## What DKM cannot do

- **No live mid-turn delivery.** A session learns about a receipt when it starts or receives a prompt. Ingest is a
  cursored pull on injection hooks.
- **No cross-machine propagation beyond GitHub.** v1 uses GitHub comments and each checkout's local `.dkm/` state.
- **No inbound consent path.** `decide()` accepts only permission input and parsed policy. It imports neither the
  pending store nor the GitHub client, so fetched content cannot become a grant through the engine.
- **No learning precedent store yet.** v1 authority comes from committed policy, not accumulated inference.
- **No delivery receipt.** A queued event is removed when a session drains it. Nothing records whether the model acted
  on it.
- **No automatic stale-head check.** Ingest does not compare a receipt's observed SHA with the current remote head.
- **No enforced hop budget.** `rootId` and `hops` are written and shape-checked but never used for control flow.
- **Narrow ambient feed.** Ambient ingest has no separate @mention or base-branch CI source.

## Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](../CONTRIBUTING.md) contains setup and review rules.

- [`AGENTS.md`](../AGENTS.md) — canonical instructions for humans and agentic tools
- [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) — the Contributor Covenant
- [`SECURITY.md`](../SECURITY.md) — private vulnerability reporting
- [`CHANGELOG.md`](../CHANGELOG.md) — release history and known limitations

## Licence

[MIT](../LICENSE). Copyright 2026 TolongLabs.

## How work ships

`main` is PR-gated, and there are no stray commits.

1. Branch as `<type>/<short-slug>`.
1. Commit as `<type>[scope]: <description>`, using a lowercase imperative without a trailing period. Allowed types are:

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
