---
description: Set this tab up as a peer, watch for @mentions, keep yourself alive, and ship the goal while the human is away
argument-hint: <the goal, in one line>
allowed-tools: Bash(bun:*), Monitor, CronCreate, CronList, ListAgents, SendMessage
---

The human is about to leave. The goal is: **$ARGUMENTS**

Do the following, in order, and then start working. The human cannot see command output, so restate anything they need
in your reply.

## 1. Find your peers

Call `ListAgents`. Every other local Claude Code session in this same directory is a peer working on the same goal. If
there are none, you are working alone and that is fine.

## 2. Watch for @mentions

Start a `Monitor` with `persistent: true` and this exact command:

```
bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts mentions --watch
```

It prints one line whenever a teammate @mentions the human on this repository, and each line reaches you as a
notification. When one arrives, read the linked issue or pull request, do what it asks if it is within the goal, and
reply on it with what you did and the commit it landed in. If it is outside the goal, reply that the human is away and
it is queued.

If the command exits at once saying `gh` is not authenticated or there is no GitHub remote, say so in one line and skip
this step; nothing else depends on it.

## 3. Keep yourself alive

Create one `CronCreate` job on `7,37 * * * *` with this prompt:
`DKM heartbeat: check whether the goal is shipped. If not, continue working on it. If a usage limit interrupted you, pick up where you left off.`
Check `CronList` first and do not create a second one if a DKM heartbeat already exists. It lives for this session and
expires after seven days; tell the human that in your reply.

## 4. Split the work

If you have peers, message each one with `SendMessage`: the goal, which part you are taking, and which part you suggest
they take. Prefer splitting by file or by feature so two peers never edit the same file. Do not wait for replies before
starting.

## 5. Ship

Work until the goal is met. Commit as you go with clear messages. When you finish, record it:
`bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts note Shipped: <one line on what landed and where>`.

## The rules while the human is away

- Decide. Do not ask. If two designs are viable, pick the simpler one and note the choice with
  `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts note <what you chose and why>`.
- Prefer a non-breaking change over a clean one. The human wants it shipped, not perfect.
- If something is genuinely blocked and no assumption is safe, record it with
  `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts blocker <what and why>`, then move to the next thing.
- Never push to `main` directly. Branch, commit, push the branch, open a pull request.
- When DKM denies a tool call, do not retry it. It was denied by the policy the human wrote.

Reply now with: how many peers you found, whether the mention watch is running, that the heartbeat exists, and the part
of the goal you are starting on. Then begin.
