# AGENTS.md

Canonical, tool-agnostic project instructions. Every agentic tool works from this file; `CLAUDE.md` only points here.
**Read [`docs/PRODUCT.md`](docs/PRODUCT.md) before acting.**

Contents:

1. [Project](#project)
1. [The authority principle](#the-authority-principle)
1. [Tracking tiers](#tracking-tiers)
1. [How to work](#how-to-work)
1. [The gate before implementation](#the-gate-before-implementation)
1. [Documentation hygiene](#documentation-hygiene)
   1. [README versus TRD](#readme-versus-trd)
1. [Tech stack and commands](#tech-stack-and-commands)
1. [Code style](#code-style)
1. [How work ships](#how-work-ships)
1. [Critical do-nots](#critical-do-nots)

## Project

**Don't Kacau Me** (DKM) is a Claude Code plugin that carries verified work context between the agent fleets of
different developers, and decides on its installer's behalf inside their own sessions, so that no human has to act as a
courier or a decision queue.

Repo: `github.com/AlaskanTuna/dont-kacau-me` (private). Built by TolongLabs.

**Pure hooks, no daemon.** Nothing runs between hook firings, so nothing can die silently and leave a stale inbox
looking healthy. The binding constraint is the hook timeout: everything on the hot path is a local `git`, file or `gh`
operation.

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

**Proceed without asking** on anything with a sensible default:

- library choice
- file layout
- naming
- installing a dependency
- writing tests or types
- fixing a bug in code you are already touching

Name the choice and move on.

**Stop and ask only for these:**

1. The authority principle is at risk
1. The change breaks something already working and you cannot avoid it
1. `bun run lint` or `bun run typecheck` fails and you cannot fix it
1. A credential or external account is missing

## The gate before implementation

**No implementation starts until `docs/` holds all three.**

- `docs/PRODUCT.md` — **Who and why.** The user, their problem, the scope ladder
- `docs/PRD.md` — **What.** Requirements, acceptance criteria, what is out of scope
- `docs/TRD.md` — **How.** Architecture, hook contracts, data models, rationale

The design spec in [`docs/superpowers/specs/`](docs/superpowers/specs/) is the source these three are derived from, and
is superseded by them once they exist.

## Documentation hygiene

**[`docs/markdown-style.md`](docs/markdown-style.md) is the style guide for every Markdown file in this repo.** It
covers:

- document layout
- headings
- lists
- code blocks
- links
- images
- tables

The rules below are this project's additions to it, not a replacement.

- **Sentence case for headings, bold lead-in labels and table headers.** Acronyms and proper names keep their form:
  - DKM
  - AI
  - API
  - PR
  - SHA
  - GitHub
  - TOML
  - Biome
  - Bun
- **No clumped prose.**
  - No block over four lines.
  - Three or more consecutive bolded-lead-in paragraphs are a list.
  - An enumeration of three or more items inside a sentence is a list.
- **A table must earn itself.** Use one for uniform data across two dimensions. A two-column table of labels and prose
  is a list; so is a one-column table
- **Never drop a measured figure, a citation, a section reference or a limitation** to save space. Reformatting must be
  lossless
- **Never create a second file overlapping an existing one.** Update the existing file

### README versus TRD

Both may describe architecture. They differ in **depth and audience**, not subject.

|              | `docs/README.md`                                                | `docs/TRD.md`                                   |
| ------------ | --------------------------------------------------------------- | ----------------------------------------------- |
| **Audience** | Anyone landing on the repo: users, reviewers, prospective users | Developers implementing against it              |
| **Depth**    | High-level narrative: the whats, hows and whys                  | Canonical implementation-level reference        |
| **Contains** | What it does, how to install, architecture overview, limits     | Hook contracts, data models, schemas, rationale |
| **Rule**     | Anything an outside reader needs must live here                 | Never duplicate the README. Go deeper instead   |

## Tech stack and commands

- **Bun** — Package manager, script runner and test runner
- **Biome** — Lint and format for JS, TS, JSON
- **Prettier** — Format for Markdown and YAML, the two Biome does not cover
- **TypeScript** — `tsc --noEmit`; strict, `noUncheckedIndexedAccess`
- **commitlint + husky + lint-staged** — Conventional Commits on `commit-msg`; staged files linted on `pre-commit`

```bash
bun install          # dev tooling; also wires husky hooks
bun run lint         # biome check . && prettier --check
bun run format       # biome format --write . && prettier --write
bun run typecheck    # tsc --noEmit
bun test             # unit tests
```

## Code style

- **Biome is authoritative:**
  - single quotes
  - no semicolons
  - no trailing commas
  - 120-char lines
  - 2-space indent
- **Types:** no `any`; prefer `unknown` plus narrowing. Validate at system boundaries
- **Comments:** default to none. Comment only when the _why_ is non-obvious
- **Changes are surgical.** Every changed line traces to what was asked

## How work ships

**`main` is PR-gated. No stray commits.**

1. **Branch.** `<type>/<short-slug>`
1. **Commit** as `<type>[scope]: <description>`, imperative, lowercase, no trailing period. Types:
   - `feat`
   - `fix`
   - `refactor`
   - `docs`
   - `test`
   - `chore`
   - `style`
   - `perf`
1. **Push and open a PR** with `gh pr create`
1. **Merge** the squashed head, pinning the verified 40-character head SHA and deleting the branch

**TODOs live in GitHub Issues**, not a markdown checklist and not a code comment.

## Critical do-nots

- **Do not** create a path from an inbound message to a permission decision. See the authority principle
- **Do not** publish raw transcripts or unrestricted tool output. The receipt is a fixed allowlisted schema
- **Do not** treat `reported` or `unverified` receipt fields as fact about the repository
- **Do not** emit a receipt when no state changed. `Stop` means the agent finished a response, not that work is done
- **Do not** deduplicate on message text. Identical prose can represent two distinct states
- **Do not** bind a receipt using a directory basename or branch name. Node IDs only
- **Do not** run a background poller. Ingest is a cursored pull on the injection hooks
- **Do not** commit `.env`, or push directly to `main`
