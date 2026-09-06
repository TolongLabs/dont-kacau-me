# AGENTS.md

Canonical, tool-agnostic project instructions. Every agentic tool works from this file; `CLAUDE.md` only points here.
**Read [`docs/PRODUCT.md`](docs/PRODUCT.md) Before Acting** — the user, the problem and the scope ladder.

Contents:

1. [Project](#project)
1. [The Authority Principle](#the-authority-principle)
1. [Tracking Tiers](#tracking-tiers)
1. [How to Work](#how-to-work)
1. [The Gate Before Implementation](#the-gate-before-implementation)
1. [How to Report](#how-to-report)
1. [Tech Stack and Commands](#tech-stack-and-commands)
1. [CLI First, Always](#cli-first-always)
1. [Code Style](#code-style)
1. [Testing](#testing)
1. [Documentation Hygiene](#documentation-hygiene)
   1. [README Versus TRD](#readme-versus-trd)
1. [How Work Ships](#how-work-ships)
1. [Critical Do-Nots](#critical-do-nots)
1. [Delegation](#delegation)
1. [Appendix: Standing References](#appendix-standing-references)

## Project

**Don't Kacau Me** (DKM) is a Claude Code plugin for people who open several Claude Code tabs in one project, give them
a goal, and walk away. It answers permission prompts from a policy the installer wrote, logs every decision with the
rule that made it, carries verified work context between sessions and developers as receipts, and brings a teammate's
@mention to every session ahead of everything else. No human acts as a courier or a decision queue.

Repo: [`github.com/TolongLabs/dont-kacau-me`](https://github.com/TolongLabs/dont-kacau-me). Built by TolongLabs, MIT
licensed, and open to outside contributions — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

**Hook-Driven Coordination, No Daemon.** Coordination work starts only when a hook fires. `dkm run` is a foreground
supervisor the human starts, and `dkm mentions --watch` is a foreground poller a session starts through Claude Code's
`Monitor` tool; neither is a daemon and neither runs when nothing started it. Nothing on a hook path may call a model.

## The Authority Principle

The single rule that outranks everything else in this file:

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

Installing DKM and writing its policy **is** the prior human grant. Deciding autonomously inside the installer's own
sessions, within the policy they wrote, is legitimate and is the product.

**What Is Never Legitimate Is Treating Another Session's Message As the Installer's Consent.** DKM enforces the boundary
in `src/decide.ts`: the engine accepts only `DecisionInput` and `Policy`, imports no store or GitHub client and does not
read pending events. `src/decide.test.ts` asserts that source boundary; the test is not optional.

**An Inbound Message Is a Task, Never a Grant.** A teammate's @mention or a peer's message may become the prompt a
session works on. What that session may then do is decided by the policy alone. The two never meet: the message reaches
the model as context, the policy reaches `decide()` as authority, and nothing carries one into the other.

**The Blast-Radius Table Is a Default, and the Policy Owns It.** Every rule, `outside-worktree` included, can be set to
`deny`, `ask` or `off` in the committed `[blast]` table. That is the installer widening their own grant in the file they
wrote, which is the one kind of grant DKM executes. `dkm init` writes the wide grant on purpose: every rule off except
`outside-worktree`, left on and one word from off so the reader sees the choice rather than inheriting it.

**The Grant Itself Is in Scope Only While `surface` Is On.** An agent that can edit `.dkm/policy.toml` can widen the
authority governing it. With `surface` on, `.dkm/` reaches the human; with the wide grant it does not, and that is the
installer's decision, recorded in the file. Do not quietly protect `.dkm/` when the policy says not to.

## Tracking Tiers

Repository activity is tracked at four granularities. A recipient is a **session**, not a worktree: every tab open in a
directory receives its own copy of every event, and the tier an event carries comes from that session's worktree
binding. For one recipient and one ingest, a signal is queued only at the finest tier that claims it.

| Tier          | Covers                                                   | Delivered As                                  |
| ------------- | -------------------------------------------------------- | --------------------------------------------- |
| **Mentioned** | A teammate @mentioned the installer on this repository   | Headline and URL, ahead of everything else    |
| **Bound**     | The work item this worktree owns                         | Receipt-derived summary                       |
| **Followed**  | Work items this session declared a dependency on         | Receipt-derived summary                       |
| **Ambient**   | Other issues and PRs updated since the repository cursor | Headline and URL; response bodies are dropped |

**Raw Commits Are Not an Ambient Signal.** `fetchSince()` queries updated issues and PRs. A publisher's `Stop` receipt
captures its current head SHA; there is no repository-wide commit feed.

## How to Work

**Proceed Without Asking** on anything you can name a sensible default for, including:

- selecting an implementation approach
- installing a dependency
- refactoring your own code mid-task
- writing tests or types you judge necessary
- fixing a bug in code you are already touching

If two approaches are close, pick one and say which. **A reversible decision made now beats a correct decision made
after a ten minute conversation.**

**Stop and Ask Only for These Six.** If it is not on this list, proceed:

1. **The Authority Principle Is at Risk.** A path from an inbound message to a grant, or a change that lets an agent
   widen its own policy
1. **The Change Would Break Something Already Working**, and you cannot avoid it
1. **`bun run lint`, `bun run typecheck` or `bun test` Fails and You Cannot Fix It.** Say what fails and what you tried
1. **A Change Is Outward-Facing**: it creates or writes to a repository, an issue or a comment that someone else reads
1. **A Credential or External Account Is Missing** and you cannot proceed
1. **Two Pieces of Work Genuinely Conflict** and shipping both is impossible

**Name the Choice and Move On.** Announcing that you are about to decide something costs more than deciding it.

## The Gate Before Implementation

**No Implementation Starts Until `docs/` Holds All Three.** Cheap to write, expensive to skip: without them the first
days produce code nobody agreed to.

| File              | Answers                                                                         | Owns                                      |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| `docs/PRODUCT.md` | **Who and why.** The user, their problem, the scope ladder                      | The spine. Everything downstream cites it |
| `docs/PRD.md`     | **What.** Requirements, acceptance criteria, what is out of scope               | Scope                                     |
| `docs/TRD.md`     | **How.** Architecture, hook contracts, data models, schemas, decision rationale | Technical truth. Canonical over this file |

**The Gate Is Binary.** If the three are not all present, the answer to "can I start building" is no. Say so, and write
the missing one.

The design spec in [`docs/superpowers/specs/`](docs/superpowers/specs/) is the source these three are derived from, and
is superseded by them once they exist.

## How to Report

If reading your message takes longer than doing the thing, you have cost time.

- **Lead With What Happened.** The first sentence answers "what is the state of things now?" No preamble, no restating
  the request
- **Three to Five Sentences** for a normal update. Longer only when something broke and the detail is needed
- **Say What a Human Should Do, or Say Nothing Is Needed.** Never leave someone guessing whether they are blocked
- **No Status Theatre.** Do not narrate rejected work or repeat what you already said
- **When Something Breaks, Give the Error Verbatim.** Paste the trace, then say in one plain sentence what it means
- **Report a Measurement, Not an Impression.** "90 pass, 0 fail" beats "tests look good"

## Tech Stack and Commands

- **Bun** is the package manager, script runner and test runner.
- **Biome** lints and formats JS, TS and JSON.
- **Prettier** formats Markdown and YAML, which Biome does not own here.
- **TypeScript** runs as `tsc --noEmit` with strict checking and `noUncheckedIndexedAccess`.
- **commitlint, husky and lint-staged** are installed and configured as development tools. The repository has no project
  `pre-commit` or `commit-msg` script under `.husky/`, so they do not enforce a commit gate automatically.
- **`gh`** is the repository transport for receipt, issue and check operations.

```bash
bun install          # install dev tooling and run the package prepare script
bun run lint         # biome check . && prettier --check
bun run format       # biome format --write . && prettier --write
bun run typecheck    # tsc --noEmit
bun test             # unit and end-to-end tests
```

**Prettier Owns Markdown and YAML, Biome Owns Everything Else**, split by file extension rather than an ignore file.
`.prettierrc.json` mirrors every formatter setting `biome.json` states, so both wrap at 120 and neither can undo the
other. `embeddedLanguageFormatting` is off, so fenced code samples are never rewritten.

A linked worktree needs its own `bun install` before `bun run lint` or `bun run typecheck` will resolve their binaries.

The layout tree lives in [`docs/README.md`](docs/README.md#repository-layout), because a reviewer must read it without
opening this file.

## CLI First, Always

Reach for a CLI before a dashboard: `gh` for GitHub, `bun` for Node. Clicking through a dashboard leaves no trace,
cannot be handed to a teammate, and cannot be repeated tomorrow.

**If the CLI Is Missing, Say so Immediately and Give the Install Command.** Do not route a human through the web UI as a
workaround.

**Read the Tool's Own Contract Rather Than a Description of It.** Claude Code's `--help`, its hook payloads and its
error strings are the authority on how a hook behaves. Guessing a payload shape from documentation, or from what would
be reasonable, is how this project shipped four broken hook contracts at once.

## Code Style

- **Biome Is Authoritative:**
  - single quotes
  - no semicolons
  - no trailing commas
  - 120-char lines
  - 2-space indent
- **Types:** no `any`; prefer `unknown` plus narrowing. Validate at system boundaries
- **Error Handling:** validate at boundaries; do not wrap internal calls in try/catch. A hook is the exception — it
  fails open and exits 0, because a DKM defect must never wedge a session
- **Comments:** default to none. Comment only when the _why_ is non-obvious. Never describe _what_ the code does
- **Changes Are Surgical.** Every changed line traces to what was asked. Remove the imports and functions your own
  change orphaned; leave pre-existing dead code alone and mention it

## Testing

**A Test That Has Never Been Seen to Fail Is Decoration.** Two rules, both learned the expensive way.

**Pin the Harness's Contract, Not Your Own.** DKM's tests once asserted the exact JSON the code emitted, so the suite
was green while the harness rejected every one of those payloads and denied the tool. A test that reads back the shape
your code produces proves the code is self-consistent and nothing else. Assert against the shape Claude Code, `git` or
`gh` actually accepts, and get that shape from the tool, not from memory.

The same failure hides in fixtures. A fake `gh` that matched a path by substring accepted `repos/<node id>/issues`,
which 404s against real GitHub. **Make a fixture reject what the real service would reject.**

**Mutation-Test Every New Test Before Trusting It.** Deliberately break the claimed behavior and confirm the test
catches the mutation before restoring the code. This is not optional and it is not slow. It has caught, so far:

- a receipt idempotency test that passed with the emit condition deliberately broken, because its fixture queue ran dry
  on the second pass and the error was swallowed
- worktree store tests whose temp directories were not git repositories, so they never exercised the worktree path
- a fail-open test that never reached the `catch` it claimed to cover, because a malformed payload returns early down
  the normal path

**Nothing Is Proven Until It Has Run Inside a Real Session.** Handlers invoked as child processes against a fake `gh`
prove the handlers. They do not prove the end-to-end harness contract.

## Documentation Hygiene

**[`docs/markdown-style.md`](docs/markdown-style.md) Is the Style Guide for Every Markdown File in This Repo.** Read it
before restructuring a document. It covers:

- document layout
- headings and lists
- code blocks and links
- images and tables

The rules below are this project's additions to it, not a replacement.

- **Title Case for headings, bold lead-in labels and table headers.** Capitalise every word except articles,
  coordinating conjunctions and prepositions of three letters or fewer, unless first or last; both halves of a
  hyphenated word; never text in backticks. Acronyms and proper names keep their form. Preserve these spellings:
  - DKM, AI, API, PR, SHA and CI
  - GitHub, TOML and Markdown
  - Biome, Bun, Prettier and TypeScript
  - Claude Code
- **No Clumped Prose.** No block over four lines. Three or more consecutive bolded-lead-in paragraphs are a list. An
  enumeration of three or more items inside a sentence is a list
- **A Table Must Earn Itself.** Use one for uniform data across two dimensions. A two-column table of labels and prose
  is a list; so is a one-column table
- **Never Drop Information to Save Space.** Reformatting must preserve:
  - measured figures
  - citations
  - section references
  - limitations
- **Never Create a Second File Overlapping an Existing One.** Update the existing file
- **Never Rewrite the Design Spec.** [`docs/superpowers/specs/`](docs/superpowers/specs/) records what was decided and
  when. Its structure and framing follow the style guide; its substance is history and is not edited to match what was
  later built
- **Do Not Reformat Vendored Content.** Installed skills and anything under a `skills/` directory carry upstream text
- **A Limitation Is Documentation.** When a defect is filed rather than fixed, it belongs in the README's limitations
  with a link to the issue, not only in the tracker

### README Versus TRD

Both may describe architecture. They differ in **depth and audience**, not subject.

|              | `docs/README.md`                                                | `docs/TRD.md`                                   |
| ------------ | --------------------------------------------------------------- | ----------------------------------------------- |
| **Audience** | Anyone landing on the repo: users, reviewers, prospective users | Developers implementing against it              |
| **Depth**    | High-level narrative: the whats, hows and whys                  | Canonical implementation-level reference        |
| **Contains** | What it does, how to install, architecture overview, limits     | Hook contracts, data models, schemas, rationale |
| **Rule**     | Anything an outside reader needs must live here                 | Never duplicate the README. Go deeper instead   |

"It is in the TRD" is a valid answer for implementation detail, **not** for anything an outside reader needs. The README
lives in `docs/`, not the repo root, so keep its links relative to `docs/`.

**When Behaviour Changes, Both Move Together.** A hook contract that changes in `src/` is wrong in the TRD until the TRD
says so, and wrong in the README if the README described it. A PR that changes a contract without touching the docs that
describe it is incomplete.

## How Work Ships

**`main` Is PR-Gated. No Stray Commits.**

1. **Branch.** `<type>/<short-slug>`, matching the commit types below
1. **Commit** in [Conventional Commits](https://www.conventionalcommits.org/) form: `<type>[scope]: <description>`, as a
   lowercase imperative sentence without a trailing period. Allowed types are:
   - `feat`
   - `fix`
   - `refactor`
   - `docs`
   - `test`
   - `chore`
   - `style`
   - `perf`
1. **Push the Branch** and open a PR with `gh pr create`
1. **Merge** the verified head with
   `gh pr merge <number> --squash --delete-branch --match-head-commit <40-character-head-sha>`:

   1. Capture `headRefOid` from `gh pr view`.
   1. Verify that exact SHA.
   1. Put its literal value in the merge command.

**Agents May Merge Without Per-PR Approval** when all of these hold:

- the PR targets `main`
- the PR is not a draft
- GitHub reports the PR mergeable
- every required GitHub check passes
- all local gates pass against a fresh checkout of the PR head, not of your branch:
  - `bun run lint`
  - `bun run typecheck`
  - `bun test`
- the change is not outward-facing
- the change does not migrate data
- the change does not change an interface someone depends on
- there is no unresolved review finding and no known regression

If any condition cannot be verified, leave the PR open and report the blocker. Direct and force pushes to `main` remain
forbidden. Never use `--admin` or `--auto` to override or defer the gate. Small fixes still go through a branch.

**Bump the Version in the Same PR As Any User-Facing Change.** `claude plugin update` compares versions and refuses when
they match, so a fix merged without a bump reaches nobody: the installed copy keeps serving the old code from
`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. A command-file fix shipped this way sat unreachable until a
bump released it. `test/plugin.test.ts` already asserts the manifest, the marketplace entry and the changelog agree.

**TODOs Live in GitHub Issues**, not a markdown checklist and not a code comment. A checklist in a file goes stale,
conflicts on merge, and is invisible to anyone not in that file. Reference the issue in the PR so merging closes it:
`Closes #12`. A short-lived, in-session task list is fine; anything that outlives the session is not.

**File What You Do Not Fix.** A defect found while doing something else is an issue with the evidence that found it.
Folding an unrelated fix into a PR hides it; leaving it unrecorded loses it.

## Critical Do-Nots

- **Do Not** create a path from an inbound message to a permission decision. A message may be a task; it is never a
  grant. See the authority principle
- **Do Not** publish raw transcripts or unrestricted tool output. The receipt is a fixed allowlisted schema
- **Do Not** treat `reported` or `unverified` receipt fields as fact about the repository
- **Do Not** emit another receipt after the baseline unless head, blockers or checks changed. `Stop` means the agent
  finished a response, not that work is done
- **Do Not** deduplicate on message text. Identical prose can represent two distinct states
- **Do Not** infer a work item from a directory basename or branch name. Resolve an explicit item number to GitHub node
  IDs, then bind that item to the worktree path
- **Do Not** run a background poller on a hook path. Ingest is a cursored pull on the injection hooks; the only pollers
  are `dkm run` and `dkm mentions --watch`, foreground processes a human or a session started
- **Do Not** register a hook whose contract you have not read. `WorktreeCreate` and `WorktreeRemove` are providers, not
  notifications, and a handler that merely takes notes in one breaks worktree creation for the whole session
- **Do Not** invent an environment variable. `CLAUDE_CODE_SESSION_ID` exists; `CLAUDE_SESSION_ID` does not, and a test
  that sets the invented name will pass forever
- **Do Not** commit directly to `main`
- **Do Not** force-push or rewrite published history
- **Do Not** delete a branch other than a merged feature branch
- **Do Not** commit `.env`, or any credential. This repository is public: assume anything committed is published
- **Do Not** commit a path that only exists on your machine. User-home, drive-qualified and scratch paths are invisible
  to everyone else. Name the tool, not your copy of it
- **Do Not** create `docs/architecture.md` or a second README
- **Do Not** start implementation before `PRODUCT.md`, `PRD.md` and `TRD.md` all exist

## Delegation

Bulk mechanical work goes to a worker CLI so the main agent spends its budget on judgement. **Delegate the
transformation, never the decision**: structural and API-contract decisions stay here, as does other judgement whose
errors would be quiet and expensive.

A worker has none of your context. Its brief must include:

- every file it may create
- the concrete output format
- the relevant house rules from this file
- anything that must survive verbatim

| Worker            | Use For                                           | Standing Gotcha                                                         |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `devin-fanout`    | Multi-file edits and per-file analysis, free tier | Exits 0 having silently done nothing after one rejected tool call       |
| `opencode-fanout` | The same shape of work on a different worker pool | Exits 0 when its input was outside `--dir` and auto-rejected            |
| `codex`           | Image generation, which Claude Code cannot do     | Needs an absolute output path; resize before anything lands in the repo |

**Always Tell a Devin Worker: Do Not Execute Commands; Write the Files Only.** One rejected tool call ends the run
without an error, and a worker has reported success having produced zero files.

**Verify Every Worker's Output Yourself.** Never report success from an exit code. Run the tests, read the parts that
carry risk, and grep the log for a rejected tool call. Say what you corrected when you report — that is what tells the
next person whether to use a stronger model or a tighter brief.

Six concurrent workers is the ceiling. Past that they contend for the same files and review costs more than the saving.

## Appendix: Standing References

Moved out of the sections above so they are not reloaded into every session. **The sections above outrank them wherever
they disagree.**

| Reference                | Lives In                                             | Applies                                         |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------- |
| **Markdown style guide** | [`docs/markdown-style.md`](docs/markdown-style.md)   | Every Markdown file in the repo                 |
| **The design spec**      | [`docs/superpowers/specs/`](docs/superpowers/specs/) | History. Superseded by the three gate documents |

Two per-machine tools may be present, and neither is required:

- **`rtk`** may rewrite a shell command before DKM receives the `Bash` payload. `src/decide.ts` compares `match`
  literally with that payload string, so keep command matches substring-safe
- **`graphify`** builds a codebase knowledge graph. Use it for architecture questions only once `graphify-out/` exists
