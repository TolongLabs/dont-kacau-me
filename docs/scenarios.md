# What It Looks Like in Practice

Six situations DKM is built for. Expand whichever one sounds like your week.

<details>
<summary><b>1. Away for the Night — the Goal Keeps Moving</b></summary>

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
<summary><b>2. Overnight Handoff — Skip the 3am Ping</b></summary>

A teammate needs to know whether your agent finished before they can start. Without DKM they message you and wait. With
DKM the work item already carries the head SHA, changed paths and check results, so they read it instead of asking.

You did nothing to publish it. The first bound `Stop` wrote the receipt when the repository actually moved.

</details>

<details>
<summary><b>3. Contract Change — Warn a Dependent Session</b></summary>

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
<summary><b>4. Routine Prompts — Clear the Decision Queue</b></summary>

Three agents stop on three prompts that need no new judgement: run the formatter, run the tests, write a file under
`src/`. Each one is a context switch for you.

Write those grants once in `.dkm/policy.toml` and they stop arriving. A fourth prompt that touches a migration still
waits if you left `data-loss` on, because blast-radius rules run first.

</details>

<details>
<summary><b>5. Morning Review — Inspect the Decision Log</b></summary>

```text
/dont-kacau-me:dkm-status
```

Every autonomous decision appears with the rule that produced it, so the audit is a handful of lines rather than three
transcripts. A decision with no log entry is a bug, and the test suite fails on it.

</details>

<details>
<summary><b>6. Human Judgement — Report a Blocker</b></summary>

An agent reaches a genuine judgement call: two viable designs, or a requirement nobody wrote down. It should not invent
your intent.

```text
/dont-kacau-me:dkm-note blocker Two viable shapes for the retry policy; needs a human call
```

The blocker rides the next receipt as **reported**, visibly separate from the measured fields, where you and your
teammates can see it without anyone being interrupted.

</details>

## dkm run: A Run That Outlives Its Usage Limit

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

The supervisor resumes the same session by ID rather than replaying the original prompt, so completed work is not
repeated. What it does on each outcome:

| Situation                      | Supervisor Action                                  |
| ------------------------------ | -------------------------------------------------- |
| Reset up to six hours away     | Wait until reset with a 30-second cushion          |
| Reset more than six hours away | Recheck after six hours                            |
| Missing or past reset time     | Use capped exponential backoff                     |
| Genuine error                  | Stop                                               |
| Limit without a session ID     | Stop because replaying could repeat completed work |

No code path changes credentials or the account, and nothing remains active once the foreground process exits.
