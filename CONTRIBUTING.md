# Contributing

Thanks for looking. This project has a small, opinionated set of rules, and nearly all of them exist because something
went wrong once.

**Read [`AGENTS.md`](AGENTS.md) first.** It is the canonical instruction set for humans and agentic tools alike, and it
outranks this file wherever the two disagree. What follows is the short version.

## Getting set up

```bash
bun install          # dev tooling; also wires the husky git hooks
bun run lint         # biome check . && prettier --check
bun run typecheck    # tsc --noEmit
bun test             # unit and end-to-end tests
```

You need [Bun](https://bun.sh/), an authenticated [`gh`](https://cli.github.com/), and Claude Code if you want to run
the plugin rather than only its tests.

## The two testing rules

These are not style preferences. Both were learned by shipping something broken.

1. **Pin the harness's contract, not your own.** A test that reads back the shape your own code emits proves the code is
   self-consistent and nothing else. DKM once had a green suite while Claude Code rejected every payload it produced and
   denied the tool. Assert against what Claude Code, `git` or `gh` actually accept, and get that shape from the tool.

1. **Mutation-test every new test before trusting it.** Break the thing the test claims to check, confirm it fails,
   restore. A test that has never been seen to fail is decoration. This has caught three tests in this repository that
   passed while proving nothing.

Say in your PR which mutations you ran and that they were caught.

## Making a change

1. Branch as `<type>/<short-slug>`
1. Commit as [Conventional Commits](https://www.conventionalcommits.org/): `<type>[scope]: <description>`, one
   imperative sentence, lowercase, no trailing period. Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`,
   `style`, `perf`. `commitlint` enforces this on commit
1. Keep changes surgical. Every changed line should trace to what was asked. Remove the imports and functions your own
   change orphaned; leave pre-existing dead code alone and mention it
1. **If you change a hook contract or any behaviour, move the docs with it.** A PR that changes a contract without
   touching [`docs/TRD.md`](docs/TRD.md), and [`docs/README.md`](docs/README.md) where it described the same thing, is
   incomplete
1. Open a PR with `gh pr create`. CI must pass, and so must a fresh `bun run lint`, `bun run typecheck` and `bun test`

## Documentation

[`docs/markdown-style.md`](docs/markdown-style.md) governs every Markdown file. The additions this project makes to it
are in `AGENTS.md` under "Documentation hygiene". The ones people trip over:

- Sentence case for headings, bold lead-in labels and table headers
- No prose block over four lines
- A table must earn itself. A two-column table of labels and prose is a list
- Reformatting must be lossless. Never drop a measured figure, a citation or a limitation to save space

## The one thing that is not negotiable

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

DKM must contain no code path from an inbound message to a permission grant. `NFR-AUTH` asserts it by test. A change
that weakens this will not be merged, however convenient it is.

## Reporting a bug

Use the issue templates. For anything security-shaped, follow [`SECURITY.md`](SECURITY.md) instead and do not open a
public issue.
