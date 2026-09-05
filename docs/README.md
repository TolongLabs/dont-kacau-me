![Don't Kacau Me](assets/dkm-banner.png)

# Don't Kacau Me

![Claude Code plugin](https://img.shields.io/badge/Claude_Code_Plugin-D97757?style=for-the-badge&logo=claude&logoColor=white)
![Bun](https://img.shields.io/badge/Bun_runtime-000000?style=for-the-badge&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript_strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Biome](https://img.shields.io/badge/Biome_lint_%26_format-60A5FA?style=for-the-badge&logo=biome&logoColor=white)
![MIT licence](https://img.shields.io/badge/MIT_licence-blue?style=for-the-badge)
![Version](https://img.shields.io/badge/v0.5.1-informational?style=for-the-badge)

**A Claude Code plugin that answers for your AI coding sessions — and keeps them working while you are away.**

_Kacau_ is Malay for "to disturb". The name is the product: don't bother me.

> No human courier. No human decision queue. No manufactured consent.

## Table of contents

<details>
  <summary>Expand</summary>
  <ol>
    <li><a href="#is-this-for-you">Is this for you?</a></li>
    <li><a href="#the-two-problems">The two problems</a></li>
    <li><a href="#what-dkm-does-about-them">What DKM does about them</a></li>
    <li><a href="#the-rule-that-keeps-this-safe">The rule that keeps this safe</a></li>
    <li><a href="#getting-started">Getting started</a></li>
    <li><a href="#the-commands">The commands</a></li>
    <li><a href="#what-it-looks-like-in-practice">What it looks like in practice</a></li>
    <li><a href="#what-dkm-cannot-do">What DKM cannot do</a></li>
    <li><a href="#under-the-hood">Under the hood</a></li>
    <li><a href="#architecture">Architecture</a></li>
    <li><a href="#configuration">Configuration</a></li>
    <li><a href="#tech-stack">Tech stack</a></li>
    <li><a href="#repository-layout">Repository layout</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#licence">Licence</a></li>
    <li><a href="#how-work-ships">How work ships</a></li>
  </ol>
</details>

## Is this for you?

You open **several Claude Code tabs in one project directory**, tell them a goal, and walk away. One tab fixes a bug,
another builds a feature, and you check back in the morning. A second git worktree is for a second branch — a second
session does not need one.

That works. But two new problems show up, and they get **worse the better your agents get**.

If you only ever run one session at a time, and never leave it alone, you do not need DKM yet.

## The two problems

### 1. You become the courier

Agent A finishes something. Agent B needs to know. Nothing connects them, so **you** read A's summary and paste it into
B.

Every time you do that, a fact becomes prose. It loses the commit it was true at, and nobody can check it any more.
Teammates have the same problem from outside: they message you to ask whether your agent finished, and the answer waits
until you wake up.

### 2. You become the queue

Every session stops and asks permission. _Run the formatter? Run the tests? Write this file?_

Three agents blocked on one person are all waiting on **your attention**, which makes you the slowest part of your own
setup. Most of those questions are not judgement calls. They are things you already decided a hundred times.

## What DKM does about them

### For the courier problem: receipts

When a session finishes a turn **and the repository actually moved**, DKM posts a comment on the GitHub issue or PR that
session is working on.

Not a summary. A **receipt**: the exact commit SHA, which files changed, whether CI passed. One comment per work item,
edited in place, so it never becomes a wall of noise.

The important part is that every field is labelled by **how much you can trust it**:

| Kind           | Where it came from                    | What you may do with it               |
| -------------- | ------------------------------------- | ------------------------------------- |
| **measured**   | `git` and `gh`, so an actual fact     | Act on it                             |
| **reported**   | The agent's claim about its own state | Route it, never treat it as repo fact |
| **unverified** | The agent's prose                     | Display it, nothing more              |

That separation is the point: an agent's opinion can never quietly become a repository fact.

### For the queue problem: a policy you write once

You write a small file, `.dkm/policy.toml`, saying what you have already decided. _Running tests is fine. Editing files
under `src/` is fine._ Those prompts stop reaching you.

Every decision made on your behalf is logged, so you can read back exactly what happened while you slept.

### And it works the goal while you are away

`/dont-kacau-me:dkm-afk <goal>` turns a tab into a peer that ships the goal unattended: it finds the other sessions open
in the same directory, starts a watch that delivers every new @mention of you on the repository, creates a heartbeat so
nothing stalls, splits the work and gets on with it.

A teammate's 2am @mention is read and answered on the issue by a peer, not left waiting for you. For a run with no tab
at all, [`dkm run`](#dkm-run-a-run-that-outlives-its-usage-limit) starts the same kind of work headlessly.

### What about `--dangerously-skip-permissions`?

It solves the same annoyance by removing the question rather than answering it, and a lot of people running several
sessions already use it. The default grant `dkm init` writes is wide on purpose — it answers what that flag would. What
stays different is the record, the receipts and the one boundary:

|                                           | `--dangerously-skip-permissions` | A DKM policy                                             |
| ----------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| Routine prompts                           | gone                             | gone                                                     |
| `rm -rf`, `git push`, a migration, `.env` | **also gone**                    | gone under the default grant; any rule can be left on    |
| A write outside this worktree             | **allowed**                      | **denied** — the one rule `dkm init` does not switch off |
| What was decided while you slept          | nothing recorded                 | every decision, with the rule that made it               |
| What lands on the work item               | nothing                          | a receipt with SHAs, changed paths and check results     |

**DKM only decides when Claude Code asks it to.** A session that answers its own prompts never sends DKM the question,
so a committed policy sits unused. That covers `--dangerously-skip-permissions` and any non-asking `--permission-mode`,
including one set as `permissions.defaultMode` in your settings, which applies to every session you start.

Since v0.4.1 a session in one of those modes says so at startup rather than looking like a policy that is working.

## The rule that keeps this safe

> Auto-answering may **execute a decision you already made**. It must never **invent one**.

Five blast-radius rules run **before** your allowances. Each is a setting in `[blast]` — `deny`, `ask` or `off` — and
unconfigured, `outside-worktree` denies while the rest ask. The policy `dkm init` writes is deliberately wide: it
switches every one of them off except `outside-worktree`.

| If the action would…                                 | Rule               | The grant `dkm init` writes |
| ---------------------------------------------------- | ------------------ | --------------------------- |
| Delete data, drop a column, or write a migration     | `data-loss`        | off                         |
| Post, publish, deploy, send, or open a network write | `egress`           | off                         |
| Spend money                                          | `money`            | off                         |
| Touch a lockfile, `package.json`, `.env` or `.dkm/`  | `surface`          | off                         |
| Write outside the session's own worktree             | `outside-worktree` | **deny**                    |
| Match a rule you wrote, and trip none of the above   | `[[allow]]`        | allow                       |

The grant is wide because it is the grant someone reaching for `--dangerously-skip-permissions` actually means: every
prompt answered, inside the worktree. What it keeps over that flag is the log — every decision in `.dkm/decisions.jsonl`
with the rule that made it — and the one line that stops an agent writing somewhere you cannot see. `outside-worktree`
is left on, and left one word from `off`, so the choice is visible rather than inherited. Switch any rule back to `ask`
or `deny` in `[blast]`; `.dkm/` is protected only when `surface` is on.

**The default grant is wide. The difference from skipping permissions is the log, the receipts and the boundary.**

![Six-panel comic: separate worktrees finish at 3am, manual copying loses provenance, the Stop hook writes a measured receipt, a teammate reads it, policy clears routine prompts, and a database migration waits for the sleeping developer](assets/dkm-comic.png)

## Getting started

**You need** [Claude Code](https://code.claude.com/docs/en/plugins) and [Bun](https://bun.sh/). For receipts you also
need an authenticated [`gh`](https://cli.github.com/) and a repository whose work you track in GitHub issues or PRs; for
the policy half you need neither.

1. **Install the plugin.**

   ```bash
   claude plugin marketplace add TolongLabs/dont-kacau-me
   claude plugin install dont-kacau-me@tolonglabs
   ```

1. **Set it up in a repository.** Restart Claude Code so it loads the plugin, then run:

   ```text
   /dont-kacau-me:dkm-init
   ```

   This checks your prerequisites and writes `.dkm/policy.toml` — a wide grant: every prompt answered, nothing written
   outside the worktree. Read the file, delete anything you did not mean to grant, and commit it. **That file is your
   grant**, so treat it as one: never copy a policy whose authority you do not intend to hand over.

   Your prompts stop arriving from here on, and this half works alone, in one session, with no GitHub issue. To publish
   receipts to a work item, bind once from any tab with `/dont-kacau-me:dkm-bind <number>`; that step needs an
   authenticated `gh` and a GitHub remote, and nothing else does.

1. **Keep working — here or from more tabs.** The policy already applies in this session. To run a goal while you are
   away, open more Claude Code tabs in the same directory — each is a peer that gets its own copy of every event — and
   run `/dont-kacau-me:dkm-afk <goal>` in one of them.

## The commands

| Command                                  | When you use it                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `/dont-kacau-me:dkm-init`                | Once per repository, to check prerequisites and write a starter policy        |
| `/dont-kacau-me:dkm-afk <goal>`          | When you are leaving: watch for @mentions, keep alive, split with peers, ship |
| `/dont-kacau-me:dkm-bind 12`             | Once per worktree, to name the issue or PR its receipts belong to             |
| `/dont-kacau-me:dkm-follow 81`           | To be told when someone else's work item changes                              |
| `/dont-kacau-me:dkm-status`              | To see what happened overnight and every decision made for you                |
| `/dont-kacau-me:dkm-note blocker <text>` | When the agent hits a real judgement call and should not guess                |

Claude Code namespaces a plugin's commands, so every DKM command is typed as `/dont-kacau-me:<command>`, never
`/<command>`.

Re-running `dkm-init` is also how you diagnose a repository later. It never replaces a policy that already exists unless
you pass `--force`.

The close-the-laptop path is not a slash command; it is a process you start yourself, described next.

### `dkm run`: a run that outlives its usage limit

A long unattended run used to end the moment your usage limit was reached. Start it under the supervisor instead:

```bash
bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts run "work through issue 12" -- --effort high
```

The run is headless. It starts Claude with `--permission-mode default --permission-prompts none`, so **your policy
answers every prompt**: what it allows goes through, anything it does not is denied with an instruction not to retry,
and the run continues. Every decision lands in `.dkm/decisions.jsonl`.

When a run stops on a limit, it reads the reset time the server reported, waits, and **resumes the same session** so the
work continues instead of starting over. It waits; it never tries to dodge the limit. Every pause is recorded in
`.dkm/revivals.jsonl`.

This is the one part of DKM that is not a hook: a foreground process you start instead of `claude`. It is optional, and
nothing runs in the background when you are not running it.

## What it looks like in practice

Six situations DKM is built for. Expand whichever one sounds like your week.

<details>
<summary><b>1. Away for the night — the goal keeps moving</b></summary>

Three tabs are open in one directory. In one of them you say:

```text
/dont-kacau-me:dkm-afk get issue 12 to a pull request
```

The tab finds its peers, starts the mention watch and a heartbeat, splits the goal and works. At 2am a teammate
@mentions you on the issue asking whether the fix landed. The watch delivers the line to a peer, which reads the thread
and replies on the issue with what it did and the commit it landed in.

You read the receipt in the morning. Nobody waited on you.

</details>

<details>
<summary><b>2. Overnight handoff — skip the 3am ping</b></summary>

A teammate needs to know whether your agent finished before they can start. Without DKM they message you and wait. With
DKM the work item already carries the head SHA, changed paths and check results, so they read it instead of asking.

You did nothing to publish it. The first bound `Stop` wrote the receipt when the repository actually moved.

</details>

<details>
<summary><b>3. Contract change — warn a dependent session</b></summary>

Agent A alters a database schema on PR #81. Agent B is building against the old shape in another worktree and would
normally discover the mismatch at merge, after both sides have paid for it.

```text
/dont-kacau-me:dkm-follow 81
```

When #81 moves, B's next turn opens with the contract delta and the exact SHA it was observed at. B adapts before
writing the wrong code, and can re-read the source rather than trust prose. The two worktrees can even be on different
developers' machines, provided both have the repository and an authenticated `gh`.

</details>

<details>
<summary><b>4. Routine prompts — clear the decision queue</b></summary>

Three agents stop on three prompts that need no new judgement: run the formatter, run the tests, write a file under
`src/`. Each one is a context switch for you.

Write those grants once in `.dkm/policy.toml` and they stop arriving. A fourth prompt that touches a migration still
waits if you left `data-loss` on, because blast-radius rules run first.

</details>

<details>
<summary><b>5. Morning review — inspect the decision log</b></summary>

```text
/dont-kacau-me:dkm-status
```

Every autonomous decision appears with the rule that produced it, so the audit is a handful of lines rather than three
transcripts. A decision with no log entry is a bug, and the test suite fails on it.

</details>

<details>
<summary><b>6. Human judgement — report a blocker</b></summary>

An agent reaches a genuine judgement call: two viable designs, or a requirement nobody wrote down. It should not invent
your intent.

```text
/dont-kacau-me:dkm-note blocker Two viable shapes for the retry policy; needs a human call
```

The blocker rides the next receipt as **reported**, visibly separate from the measured fields, where you and your
teammates can see it without anyone being interrupted.

</details>

## What DKM cannot do

- **No live mid-turn delivery of receipts.** The mention watch is live — `dkm mentions --watch` prints each new @mention
  as a poll sees it — but a session still learns about receipts when it starts or receives a prompt, because ingest is a
  cursored pull on injection hooks.
- **No cross-machine propagation beyond GitHub.** v1 uses one GitHub comment per work item and each checkout's local
  `.dkm/` state. Reaching a machine beyond what the repository carries is a v3 concern.
- **A non-asking permission mode bypasses the policy entirely.** `--dangerously-skip-permissions` and any
  `--permission-mode` that answers its own prompts never emit `PermissionRequest`, so no decision is made or logged. A
  session in one says so at startup.
- **No inbound consent path.** Another Claude session cannot approve a prompt, and a relayed approval is untrusted.
  `decide()` accepts only permission input and policy, importing neither the pending store nor the GitHub client.
- **No learning precedent store yet.** v1 authority comes from human-written, committed policy, not accumulated
  inference or precedent.
- **No delivery receipt.** A queued event is removed when a session drains it. Nothing records whether the model acted,
  so an ignored injected delta looks identical to one it used.
- **No automatic stale-head check.** Ingest does not compare a publisher's observed SHA with the current remote head
  before rendering the receipt.
- **No enforced hop budget.** `rootId` and `hops` are written and shape-checked but never incremented, rejected or used
  for control flow.
- **Narrow ambient feed.** Ambient ingest sees issues and PRs from the updated-items query, with no base-branch CI
  source. @mentions are not ambient; they are their own tier.

## Under the hood

Everything above is what you need to use DKM. The rest is how it works, for anyone extending it or reviewing it.
Implementation-level contracts, schemas and rationale live in [the technical reference](TRD.md).

## Architecture

DKM coordinates sessions through Claude Code hooks and has no daemon. Hook-driven receipt, ingest and permission work
never calls a model; the optional usage-limit supervisor is a foreground CLI process.

![DKM architecture: two worktrees feed short-lived hooks, shared DKM state publishes a receipt to a GitHub work item, and policy leaves unmatched prompts to the human](assets/architecture.svg)

And the path one receipt takes, from the turn that produced it to the session that reads it:

![Receipt flow: session A finishes a turn, the Stop hook writes a baseline or tracked delta, and session B pulls that receipt context on its next start or prompt](assets/receipt-flow.svg)

The subsections below stay at the system-narrative level. Implementation contracts and rationale live in
[the technical reference](TRD.md).

<details>
<summary><b>The hook lifecycle</b></summary>

| Hook event          | DKM action                                                                | Observable result                                  |
| ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| `Stop`              | Touch the session, then measure a bound worktree                          | Update one receipt only after a tracked delta      |
| `SessionStart`      | Register the session, pull repository updates, drain this session's queue | Inject context, plus mode and binding hints        |
| `UserPromptSubmit`  | Register or touch the session, run the same pull rate-limited, drain      | Inject available context on a later prompt         |
| `PermissionRequest` | Evaluate policy, append a record and emit or defer                        | Execute a prior grant or leave the prompt to human |
| `SessionEnd`        | Unregister the session and its queue, record the details                  | Leave a diagnostic resume ticket on disk           |

- `Stop` ends a response, not the work; after the baseline, unchanged tracked state produces no receipt.
- DKM registers no worktree lifecycle hook. Explicit binding lets the user choose the GitHub item a worktree owns.
- An unbound worktree publishes nothing, so `SessionStart` says so once, and only where a policy file exists.
- An unmatched permission or handler failure leaves the prompt to the human.
- Pull-based delivery injects queued context on session start or prompt submission, not when another session publishes.

</details>

<details>
<summary><b>Receipt delivery and tracking</b></summary>

A signal is queued only at the finest tier that claims it for one recipient and ingest. A recipient is a session, not a
worktree: every tab open in the directory gets its own copy of every event, and a worktree with no session open receives
nothing.

| Tier          | Covers                                                         | Delivered as                                               |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| **Mentioned** | A teammate @mentioned you on an issue or PR in this repository | Headline and URL, ahead of everything else                 |
| **Bound**     | The work item this worktree owns                               | Receipt summary: SHAs, contract paths, checks and blockers |
| **Followed**  | Work items this session declared a dependency on               | The same receipt summary, labelled `followed`              |
| **Ambient**   | Other issues and PRs updated since the repository cursor       | Headline and URL                                           |

- The current GitHub query returns updated issues and PRs; raw commits are not an ambient signal.
- DKM discards body fields before building a pending event.
- @mentions arrive through the notifications feed as their own tier; a base-branch CI feed is not implemented.

</details>

<details>
<summary><b>The receipt schema</b></summary>

DKM edits one GitHub comment per work item in place instead of appending comments. Every field carries one of the three
trust kinds described under [what DKM does about them](#for-the-courier-problem-receipts); `measured` is sourced from
`git`, `gh` or counted local state, `reported` is asserted by the session about itself, and `unverified` is agent prose.

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

</details>

<details>
<summary><b>Policy and authority</b></summary>

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

Installing DKM and writing `.dkm/policy.toml` is the prior human grant. DKM may decide within that committed policy in
the installer's own sessions. `src/decide.ts` receives only the current permission input and parsed policy; it imports
neither the pending-event store nor the GitHub client.

`PermissionRequest` evaluates:

1. Mechanical blast-radius rules.
1. Explicit policy allow rules for paths, tools and commands granted in advance.
1. The default human path for anything unmatched: `ask`.

The rules are mechanical rather than model-assessed because agents are poor at self-assessing risk. `.dkm/` is on the
surface list because an agent that can edit its grant can widen that authority without anyone deciding to. Each blast
row's answer is the setting in `[blast]` — `deny`, `ask` or `off` — and a rule set to `off` is not evaluated at all.
This is the exact form of the plain-English table in [the rule that keeps this safe](#the-rule-that-keeps-this-safe):

| Recognised input                                                           | Result                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------ |
| A path outside the session worktree                                        | the `outside-worktree` setting — `deny` unconfigured   |
| Recursive forced removal, destructive SQL or a `migrations`/`drizzle` path | the `data-loss` setting — `ask` unconfigured           |
| Recognised network, push, deployment, publication or release commands      | the `egress` and `money` settings — `ask` unconfigured |
| A package manifest, supported lockfile, `.env` file or path under `.dkm/`  | the `surface` setting — `ask` unconfigured             |
| The first matching policy allow rule, after no blast-radius match          | `allow`                                                |
| Anything else                                                              | `ask`                                                  |

`dkm init` writes the wide grant: every rule `off` except `outside-worktree`, and one allow rule with `tool = "*"`.
Delivery follows the same model as the rest of the product — a recipient is a session, not a worktree, so every open tab
gets its own copy of every event.

On its normal path, every permission evaluation appends to `.dkm/decisions.jsonl` before DKM emits. The status command
shows the total valid-record count and the five most recent records; a later receipt counts decisions since the prior
successful emit for that work item.

</details>

<details>
<summary><b>How the supervisor decides to wait</b></summary>

The supervisor resumes the same session by ID rather than replaying the original prompt, so completed work is not
repeated. What it does on each outcome:

| Situation                      | Supervisor action                                  |
| ------------------------------ | -------------------------------------------------- |
| Reset up to six hours away     | Wait until reset with a 30-second cushion          |
| Reset more than six hours away | Recheck after six hours                            |
| Missing or past reset time     | Use capped exponential backoff                     |
| Genuine error                  | Stop                                               |
| Limit without a session ID     | Stop because replaying could repeat completed work |

No code path changes credentials or the account, and nothing remains active once the foreground process exits.

</details>

## Configuration

`.dkm/policy.toml` is the only committed file under `.dkm/`; all other DKM state is git-ignored. Blast-radius rules run
before allow rules, and `[blast]` sets each of them to `deny`, `ask` or `off` — a rule that is `off` is not evaluated.
Anything unmatched defaults to the human path: `ask`.

| Key or section    | Value shape                      | Controls                                       | Safety behavior                                                  |
| ----------------- | -------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `version`         | Integer by convention            | Present in the file; the parser ignores it     | Loaded policy remains version 1                                  |
| `contractGlobs`   | Array of path globs              | Which changed paths form `contractDelta`       | Changes receipt content, not permission decisions                |
| `[blast].<rule>`  | `deny`, `ask` or `off`           | What each blast-radius rule does when it trips | Nothing configured: `outside-worktree` denies, the rest ask      |
| `[[allow]].tool`  | Tool name, or `*` for every tool | Tool eligible for a prior allow grant          | Still loses to a blast-radius rule that is on                    |
| `[[allow]].match` | Optional substring               | Narrows the first command, path or URL input   | First matching allow rule wins                                   |
| `[[allow]].paths` | Optional array of path globs     | Requires at least one candidate path to match  | An outside-worktree candidate still denies while that rule is on |

## Tech stack

<details>
<summary><b>The tools and what each one is for</b></summary>

| Concern                     | Technology                           | Role                                                                     |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| Plugin host                 | Claude Code hooks and slash commands | Fires the lifecycle and permission events                                |
| Runtime, packages and tests | Bun                                  | Runs TypeScript hooks, installs dev tooling and executes tests           |
| Language                    | TypeScript                           | Strict types with `noUncheckedIndexedAccess` and no emitted build output |
| Repository evidence         | Local `git` and GitHub CLI (`gh`)    | Measures worktree state and maintains issue receipts                     |
| Lint and format             | Biome and Prettier                   | Checks JS, TS and JSON; formats Markdown and YAML                        |
| Type checking               | `tsc --noEmit`                       | Verifies the TypeScript contract without producing artifacts             |
| Change tooling              | commitlint, husky and lint-staged    | Enforces Conventional Commits and lints staged files on every commit     |
| Local state                 | `.dkm/` files and JSONL              | Stores policy, bindings, cursors, pending items and decisions            |

</details>

## Repository layout

<details>
<summary><b>Every file and what it holds</b></summary>

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
  dkm-afk.md
  dkm-bind.md
  dkm-follow.md
  dkm-init.md
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
  init.ts                        # dkm init checks and the starter policy
  init.test.ts                   # init output and generated-grant tests
  policy.ts                      # restricted policy parser
  policy.test.ts                 # [blast] and allow-rule parsing tests
  receipt.ts                     # receipt render, parse and fingerprint
  revive-run.ts                  # supervised resume loop
  revive.ts                      # limit classification and wait calculation
  store.ts                       # shared .dkm state
  types.ts                       # shared contracts
  hooks/                         # registered hook entrypoints
    unbound-hint.test.ts         # startup and permission-mode hint tests
test/
  cli.test.ts                    # command integration tests
  e2e.test.ts                    # hook child-process tests
  fake-gh.ts                     # fixture-backed gh impersonator
  plugin.test.ts                 # packaging and command tests
  worktree.test.ts               # linked-worktree state tests
```

</details>

## Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](../CONTRIBUTING.md) covers setup, the commit convention and
two non-negotiable test rules: pin the harness's contract and mutation-test every new test.

- [`AGENTS.md`](../AGENTS.md) — canonical instructions for humans and agentic tools
- [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) — the Contributor Covenant
- [`SECURITY.md`](../SECURITY.md) — report a vulnerability privately, never as a public issue
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
