# AGENTS.md

Canonical, tool-agnostic project instructions. Every agentic tool works from this file; `CLAUDE.md` only points here.
**Read [`docs/PRODUCT.md`](docs/PRODUCT.md) before acting** — the user, the problem and the scope ladder.

Contents:

1. [Project](#project)
1. [The authority principle](#the-authority-principle)
1. [Tracking tiers](#tracking-tiers)
1. [How to work](#how-to-work)
1. [The gate before implementation](#the-gate-before-implementation)
1. [How to report](#how-to-report)
1. [Tech stack and commands](#tech-stack-and-commands)
1. [CLI first, always](#cli-first-always)
1. [Code style](#code-style)
1. [Testing](#testing)
1. [Documentation hygiene](#documentation-hygiene)
   1. [README versus TRD](#readme-versus-trd)
1. [How work ships](#how-work-ships)
1. [Critical do-nots](#critical-do-nots)
1. [Delegation](#delegation)
1. [Appendix: standing references](#appendix-standing-references)

## Project

**Don't Kacau Me** (DKM) is a Claude Code plugin that carries verified work context between the agent fleets of
different developers, and decides on its installer's behalf inside their own sessions, so that no human has to act as a
courier or a decision queue.

Repo: `github.com/TolongLabs/dont-kacau-me` (private). Built by TolongLabs.

**Pure hooks, no daemon.** Nothing runs between hook firings, so nothing can die silently and leave a stale inbox
looking healthy. The binding constraint is the hook timeout: everything on the hot path is a local `git`, file or `gh`
operation, and nothing on it may call a model.

## The authority principle

The single rule that outranks everything else in this file:

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

Installing DKM and writing its policy **is** the prior human grant. Deciding autonomously inside the installer's own
sessions, within the policy they wrote, is legitimate and is the product.

**What is never legitimate is treating another session's message as the installer's consent.** The harness enforces
this:

- a peer's message is labelled as coming from another Claude session
- a peer cannot approve a permission prompt
- in auto mode a relayed approval claim is treated as untrusted input

DKM must contain no code path from an inbound message to a permission grant. There is a test for this, and it is not
optional.

**The grant itself is in scope.** An agent that can edit `.dkm/policy.toml` can widen the authority governing it, which
is manufacturing consent by another route. `.dkm/` is on the blast-radius table for that reason; do not take it off.

## Tracking tiers

Repository activity is tracked at three granularities. A signal is only ever delivered at the finest tier that claims
it, so nothing is delivered twice.

| Tier         | Covers                                                                          | Delivered as                          |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------- |
| **Bound**    | The work item this worktree owns                                                | Full receipt, every field             |
| **Followed** | Work items this session declared a dependency on                                | Contract delta, head SHA, blockers    |
| **Ambient**  | Repository-wide: new issues, new PRs, @mentions, CI failures on the base branch | Headline and URL only, never the body |

**Raw commits are not an ambient signal.** A commit becomes visible as a head SHA change on a bound or followed item,
which is where it carries meaning. A repository-wide commit feed is noise with nothing actionable in it.

## How to work

**Proceed without asking** on anything you can name a sensible default for: picking a library, file layout, naming or
approach; installing a dependency; refactoring your own code mid-task; writing tests or types you judge necessary;
fixing a bug in code you are already touching. If two approaches are close, pick one and say which. **A reversible
decision made now beats a correct decision made after a ten minute conversation.**

**Stop and ask only for these six.** If it is not on this list, proceed:

1. **The authority principle is at risk.** A path from an inbound message to a grant, or a change that lets an agent
   widen its own policy
1. **The change would break something already working**, and you cannot avoid it
1. **`bun run lint`, `bun run typecheck` or `bun test` fails and you cannot fix it.** Say what fails and what you tried
1. **A change is outward-facing**: it creates or writes to a repository, an issue or a comment that someone else reads
1. **A credential or external account is missing** and you cannot proceed
1. **Two pieces of work genuinely conflict** and shipping both is impossible

**Name the choice and move on.** Announcing that you are about to decide something costs more than deciding it.

## The gate before implementation

**No implementation starts until `docs/` holds all three.** Cheap to write, expensive to skip: without them the first
days produce code nobody agreed to.

| File              | Answers                                                                         | Owns                                      |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| `docs/PRODUCT.md` | **Who and why.** The user, their problem, the scope ladder                      | The spine. Everything downstream cites it |
| `docs/PRD.md`     | **What.** Requirements, acceptance criteria, what is out of scope               | Scope                                     |
| `docs/TRD.md`     | **How.** Architecture, hook contracts, data models, schemas, decision rationale | Technical truth. Canonical over this file |

**The gate is binary.** If the three are not all present, the answer to "can I start building" is no. Say so, and write
the missing one.

The design spec in [`docs/superpowers/specs/`](docs/superpowers/specs/) is the source these three are derived from, and
is superseded by them once they exist.

## How to report

If reading your message takes longer than doing the thing, you have cost time.

- **Lead with what happened.** The first sentence answers "what is the state of things now?" No preamble, no restating
  the request
- **Three to five sentences** for a normal update. Longer only when something broke and the detail is needed
- **Say what a human should do, or say nothing is needed.** Never leave someone guessing whether they are blocked
- **No status theatre.** Do not narrate steps, list what you rejected, or summarise what you already said
- **When something breaks, give the error verbatim.** Paste the trace, then say in one plain sentence what it means
- **Report a measurement, not an impression.** "90 pass, 0 fail" beats "tests look good"

## Tech stack and commands

| Tool                                 | Role                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------- |
| **Bun**                              | Package manager, script runner and test runner                            |
| **Biome**                            | Lint and format for JS, TS, JSON                                          |
| **Prettier**                         | Format for Markdown and YAML, the two Biome does not cover                |
| **TypeScript**                       | `tsc --noEmit`; strict, `noUncheckedIndexedAccess`                        |
| **commitlint + husky + lint-staged** | Conventional Commits on `commit-msg`; staged files linted on `pre-commit` |
| **`gh`**                             | The only transport. Every receipt and every fetch goes through it         |

```bash
bun install          # dev tooling; also wires husky hooks
bun run lint         # biome check . && prettier --check
bun run format       # biome format --write . && prettier --write
bun run typecheck    # tsc --noEmit
bun test             # unit and end-to-end tests
```

**Prettier owns Markdown and YAML, Biome owns everything else**, split by file extension rather than an ignore file.
`.prettierrc.json` mirrors every formatter setting `biome.json` states, so both wrap at 120 and neither can undo the
other. `embeddedLanguageFormatting` is off, so fenced code samples are never rewritten.

A linked worktree needs its own `bun install` before `bun run lint` or `bun run typecheck` will resolve their binaries.

The layout tree lives in [`docs/README.md`](docs/README.md#repository-layout), because a reviewer must read it without
opening this file.

## CLI first, always

Reach for a CLI before a dashboard: `gh` for GitHub, `bun` for Node. Clicking through a dashboard leaves no trace,
cannot be handed to a teammate, and cannot be repeated tomorrow.

**If the CLI is missing, say so immediately and give the install command.** Do not route a human through the web UI as a
workaround.

**Read the tool's own contract rather than a description of it.** Claude Code's `--help`, its hook payloads and its
error strings are the authority on how a hook behaves. Guessing a payload shape from documentation, or from what would
be reasonable, is how this project shipped four broken hook contracts at once.

## Code style

- **Biome is authoritative:**
  - single quotes
  - no semicolons
  - no trailing commas
  - 120-char lines
  - 2-space indent
- **Types:** no `any`; prefer `unknown` plus narrowing. Validate at system boundaries
- **Error handling:** validate at boundaries; do not wrap internal calls in try/catch. A hook is the exception — it
  fails open and exits 0, because a DKM defect must never wedge a session
- **Comments:** default to none. Comment only when the _why_ is non-obvious. Never describe _what_ the code does
- **Changes are surgical.** Every changed line traces to what was asked. Remove the imports and functions your own
  change orphaned; leave pre-existing dead code alone and mention it

## Testing

**A test that has never been seen to fail is decoration.** Two rules, both learned the expensive way.

**Pin the harness's contract, not your own.** DKM's tests once asserted the exact JSON the code emitted, so the suite
was green while the harness rejected every one of those payloads and denied the tool. A test that reads back the shape
your code produces proves the code is self-consistent and nothing else. Assert against the shape Claude Code, `git` or
`gh` actually accepts, and get that shape from the tool, not from memory.

The same failure hides in fixtures. A fake `gh` that matched a path by substring accepted `repos/<node id>/issues`,
which 404s against real GitHub. **Make a fixture reject what the real service would reject.**

**Mutation-test every new test before trusting it.** Break the thing the test claims to check, confirm it fails,
restore. This is not optional and it is not slow. It has caught, so far:

- a receipt idempotency test that passed with the emit condition deliberately broken, because its fixture queue ran dry
  on the second pass and the error was swallowed
- worktree store tests whose temp directories were not git repositories, so they never exercised the worktree path
- a fail-open test that never reached the `catch` it claimed to cover, because a malformed payload returns early down
  the normal path

**Nothing is proven until it has run inside a real session.** Handlers invoked as child processes against a fake `gh`
prove the handlers. They say nothing about whether the harness loads the plugin, fires the hook, or accepts what comes
back.

## Documentation hygiene

**[`docs/markdown-style.md`](docs/markdown-style.md) is the style guide for every Markdown file in this repo.** It
covers document layout, headings, lists, code blocks, links, images and tables. Read it before restructuring a document.
The rules below are this project's additions to it, not a replacement.

- **Sentence case for headings, bold lead-in labels and table headers.** Acronyms and proper names keep their form: DKM,
  AI, API, PR, SHA, CI, GitHub, TOML, Markdown, Biome, Bun, Prettier, TypeScript, Claude Code
- **No clumped prose.** No block over four lines. Three or more consecutive bolded-lead-in paragraphs are a list. An
  enumeration of three or more items inside a sentence is a list
- **A table must earn itself.** Use one for uniform data across two dimensions. A two-column table of labels and prose
  is a list; so is a one-column table
- **Never drop a measured figure, a citation, a section reference or a limitation** to save space. Reformatting must be
  lossless
- **Never create a second file overlapping an existing one.** Update the existing file
- **Never rewrite the design spec.** [`docs/superpowers/specs/`](docs/superpowers/specs/) records what was decided and
  when. Its structure and framing follow the style guide; its substance is history and is not edited to match what was
  later built
- **Do not reformat vendored content.** Installed skills and anything under a `skills/` directory carry upstream text
- **A limitation is documentation.** When a defect is filed rather than fixed, it belongs in the README's limitations
  with a link to the issue, not only in the tracker

### README versus TRD

Both may describe architecture. They differ in **depth and audience**, not subject.

|              | `docs/README.md`                                                | `docs/TRD.md`                                   |
| ------------ | --------------------------------------------------------------- | ----------------------------------------------- |
| **Audience** | Anyone landing on the repo: users, reviewers, prospective users | Developers implementing against it              |
| **Depth**    | High-level narrative: the whats, hows and whys                  | Canonical implementation-level reference        |
| **Contains** | What it does, how to install, architecture overview, limits     | Hook contracts, data models, schemas, rationale |
| **Rule**     | Anything an outside reader needs must live here                 | Never duplicate the README. Go deeper instead   |

"It is in the TRD" is a valid answer for implementation detail, **not** for anything an outside reader needs. The README
lives in `docs/`, not the repo root, so keep its links relative to `docs/`.

**When behaviour changes, both move together.** A hook contract that changes in `src/` is wrong in the TRD until the TRD
says so, and wrong in the README if the README described it. A PR that changes a contract without touching the docs that
describe it is incomplete.

## How work ships

**`main` is PR-gated. No stray commits.**

1. **Branch.** `<type>/<short-slug>`, matching the commit types below
1. **Commit** in [Conventional Commits](https://www.conventionalcommits.org/) form: `<type>[scope]: <description>`, a
   single imperative sentence, lowercase, no trailing period. Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`,
   `chore`, `style`, `perf`
1. **Push the branch** and open a PR with `gh pr create`
1. **Merge** the verified head with
   `gh pr merge <number> --squash --delete-branch --match-head-commit <40-character-head-sha>`. Capture `headRefOid`
   from `gh pr view`, verify that exact SHA, then put its literal value in the merge command

**Agents may merge without per-PR approval** when all of these hold:

- the PR targets `main`, is not a draft, and GitHub reports it mergeable
- every required GitHub check passes
- `bun run lint`, `bun run typecheck` and `bun test` pass against a fresh checkout of the PR head, not of your branch
- the change is not outward-facing, does not migrate data, and does not change an interface someone depends on
- there is no unresolved review finding and no known regression

If any condition cannot be verified, leave the PR open and report the blocker. Direct and force pushes to `main` remain
forbidden. Never use `--admin` or `--auto` to override or defer the gate. Small fixes still go through a branch.

**TODOs live in GitHub Issues**, not a markdown checklist and not a code comment. A checklist in a file goes stale,
conflicts on merge, and is invisible to anyone not in that file. Reference the issue in the PR so merging closes it:
`Closes #12`. A short-lived, in-session task list is fine; anything that outlives the session is not.

**File what you do not fix.** A defect found while doing something else is an issue, with the evidence that found it.
Folding an unrelated fix into a PR hides it; leaving it unrecorded loses it.

## Critical do-nots

- **Do not** create a path from an inbound message to a permission decision. See the authority principle
- **Do not** publish raw transcripts or unrestricted tool output. The receipt is a fixed allowlisted schema
- **Do not** treat `reported` or `unverified` receipt fields as fact about the repository
- **Do not** emit a receipt when no state changed. `Stop` means the agent finished a response, not that work is done
- **Do not** deduplicate on message text. Identical prose can represent two distinct states
- **Do not** bind a receipt using a directory basename or branch name. Node IDs only
- **Do not** run a background poller. Ingest is a cursored pull on the injection hooks
- **Do not** register a hook whose contract you have not read. `WorktreeCreate` and `WorktreeRemove` are providers, not
  notifications, and a handler that merely takes notes in one breaks worktree creation for the whole session
- **Do not** invent an environment variable. `CLAUDE_CODE_SESSION_ID` exists; `CLAUDE_SESSION_ID` does not, and a test
  that sets the invented name will pass forever
- **Do not** commit directly to `main`, force-push, rewrite published history, or delete a branch other than a merged
  feature branch
- **Do not** commit `.env`, or any credential
- **Do not** commit a path that only exists on your machine. `/home/<you>/...`, `C:\Users\...` and scratch directories
  under `/tmp` are invisible to everyone else. Name the tool, not your copy of it
- **Do not** create `docs/architecture.md` or a second README
- **Do not** start implementation before `PRODUCT.md`, `PRD.md` and `TRD.md` all exist

## Delegation

Bulk mechanical work goes to a worker CLI so the main agent spends its budget on judgement. **Delegate the
transformation, never the decision**: what the structure should be, what an API contract is, and anything where being
wrong is quiet and expensive all stay here.

A worker has none of your context. Everything it needs goes in the brief: every file it may create, the output format
concretely, the house rules from this file, and what must survive verbatim.

| Worker            | Use for                                           | Standing gotcha                                                         |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `devin-fanout`    | Multi-file edits and per-file analysis, free tier | Exits 0 having silently done nothing after one rejected tool call       |
| `opencode-fanout` | The same shape of work on a different worker pool | Exits 0 when its input was outside `--dir` and auto-rejected            |
| `codex`           | Image generation, which Claude Code cannot do     | Needs an absolute output path; resize before anything lands in the repo |

**Always tell a Devin worker: do not run any shell command, test, formatter or git command; write the files only.** One
rejected tool call ends the run without an error, and a worker has reported success having produced zero files.

**Verify every worker's output yourself.** Never report success from an exit code. Run the tests, read the parts that
carry risk, and grep the log for a rejected tool call. Say what you corrected when you report — that is what tells the
next person whether to use a stronger model or a tighter brief.

Six concurrent workers is the ceiling. Past that they contend for the same files and review costs more than the saving.

## Appendix: standing references

Moved out of the sections above so they are not reloaded into every session. **The sections above outrank them wherever
they disagree.**

| Reference                | Lives in                                             | Applies                                         |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------- |
| **Markdown style guide** | [`docs/markdown-style.md`](docs/markdown-style.md)   | Every Markdown file in the repo                 |
| **The design spec**      | [`docs/superpowers/specs/`](docs/superpowers/specs/) | History. Superseded by the three gate documents |

Two per-machine tools may be present, and neither is required:

- **`rtk`** rewrites shell commands to a token-optimised proxy, so a `Bash` payload may arrive as `rtk git status`
  rather than `git status`. Policy matching sees the rewritten string; keep `match` rules substring-safe
- **`graphify`** builds a codebase knowledge graph. Use it for architecture questions only once `graphify-out/` exists
