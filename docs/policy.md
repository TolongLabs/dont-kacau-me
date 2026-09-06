# The policy file

`.dkm/policy.toml` is the grant DKM executes: it answers permission prompts with the decisions you recorded, and never
invents one. It is the only file under `.dkm/` that is committed; all other DKM state is git-ignored.

## What dkm init writes

`dkm init` writes a deliberately wide grant: every blast-radius rule `off` except `outside-worktree`, one allow rule
covering every tool, and a `contractGlobs` list built from the `src`, `lib` and `app` directories present in the
repository. The shape it writes:

```toml
# Written by `dkm init`. This file is your grant: DKM executes the decisions recorded here on
# your behalf, and never invents one. Every decision is logged in .dkm/decisions.jsonl with the
# rule that made it.

version = 1

# Paths whose change is worth telling a dependent session about.
contractGlobs = ["src/**/types.ts", "src/**/schema.ts"]

# Each rule that would otherwise stop the agent. "off" removes it. "ask" stops for you, and is
# auto-denied when you are not there. "deny" blocks it outright.
[blast]
outside-worktree = "deny"   # the one rule left on: nothing is written outside this worktree
data-loss = "off"           # rm -rf, destructive SQL, migrations
egress = "off"              # git push, deploys, curl, gh writes
money = "off"               # npm publish, vercel deploy, gh release
surface = "off"             # package.json, lockfiles, .env, .dkm/

# Everything else is yours to run.
[[allow]]
tool = "*"
```

An `[[allow]]` rule is a decision you made in advance: _running tests is fine, editing files under `src/` is fine_, and
the prompts it covers stop reaching you. Read the file, delete anything you did not mean to grant and commit it; never
copy a policy whose authority you do not intend to hand over.

## Compared with --dangerously-skip-permissions

The flag solves the same annoyance by removing the question rather than answering it, and a lot of people running
several sessions already use it. The default grant `dkm init` writes answers what that flag would; what stays different
is the record, the receipts and the one boundary that stops an agent writing somewhere you cannot see:

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

A session in one of those modes is told so on its first prompt and asked to tell you, rather than looking like a policy
that is working. Peers, @mentions, receipts and `dkm-afk` work in every mode; only the deciding and the log need an
asking one.

**The default grant is wide. The difference from skipping permissions is the log, the receipts and the boundary.**

## Blast-radius rules

Five blast-radius rules run **before** your allow rules. Each is a setting in `[blast]` set to `deny`, `ask` or `off`,
and a rule set to `off` is not evaluated at all. Unconfigured, `outside-worktree` denies while the rest ask; anything
unmatched defaults to the human path: `ask`.

| If the action would…                                 | Rule               | The grant `dkm init` writes |
| ---------------------------------------------------- | ------------------ | --------------------------- |
| Delete data, drop a column, or write a migration     | `data-loss`        | off                         |
| Post, publish, deploy, send, or open a network write | `egress`           | off                         |
| Spend money                                          | `money`            | off                         |
| Touch a lockfile, `package.json`, `.env` or `.dkm/`  | `surface`          | off                         |
| Write outside the session's own worktree             | `outside-worktree` | **deny**                    |
| Match a rule you wrote, and trip none of the above   | `[[allow]]`        | allow                       |

The same rules as the recognised inputs the evaluator sees:

| Recognised input                                                           | Result                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------ |
| A path outside the session worktree                                        | the `outside-worktree` setting — `deny` unconfigured   |
| Recursive forced removal, destructive SQL or a `migrations`/`drizzle` path | the `data-loss` setting — `ask` unconfigured           |
| Recognised network, push, deployment, publication or release commands      | the `egress` and `money` settings — `ask` unconfigured |
| A package manifest, supported lockfile, `.env` file or path under `.dkm/`  | the `surface` setting — `ask` unconfigured             |
| The first matching policy allow rule, after no blast-radius match          | `allow`                                                |
| Anything else                                                              | `ask`                                                  |

The rules are mechanical rather than model-assessed because agents are poor at self-assessing risk. `.dkm/` is on the
surface list because an agent that can edit its grant can widen that authority without anyone deciding to, and `.dkm/`
is protected only while `surface` is on. `outside-worktree` is left on, and left one word from `off`, so the choice is
visible rather than inherited; switch any rule back to `ask` or `deny` in `[blast]`.

## Keys

Every key and section the parser accepts:

| Key or section    | Value shape                      | Controls                                       | Safety behavior                                                  |
| ----------------- | -------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `version`         | Integer by convention            | Present in the file; the parser ignores it     | Loaded policy remains version 1                                  |
| `contractGlobs`   | Array of path globs              | Which changed paths form `contractDelta`       | Changes receipt content, not permission decisions                |
| `[blast].<rule>`  | `deny`, `ask` or `off`           | What each blast-radius rule does when it trips | Nothing configured: `outside-worktree` denies, the rest ask      |
| `[[allow]].tool`  | Tool name, or `*` for every tool | Tool eligible for a prior allow grant          | Still loses to a blast-radius rule that is on                    |
| `[[allow]].match` | Optional substring               | Narrows the first command, path or URL input   | First matching allow rule wins                                   |
| `[[allow]].paths` | Optional array of path globs     | Requires at least one candidate path to match  | An outside-worktree candidate still denies while that rule is on |

## How a decision is made

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

Installing DKM and writing `.dkm/policy.toml` is the prior human grant. DKM may decide within that committed policy in
the installer's own sessions.

`PermissionRequest` evaluates, in order:

1. Mechanical blast-radius rules.
1. Explicit policy allow rules for paths, tools and commands granted in advance.
1. The default human path for anything unmatched: `ask`.

`src/decide.ts` receives only the current permission input and the parsed policy; it imports neither the pending-event
store nor the GitHub client.

On its normal path, every permission evaluation appends to `.dkm/decisions.jsonl` before DKM emits.
`/dont-kacau-me:dkm-status` shows the total valid-record count and the five most recent records; a later receipt counts
decisions since the prior successful emit for that work item.
