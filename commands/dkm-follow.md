---
description: Follow another work item so its contract changes reach this session
argument-hint: <issue-or-pr-number>
allowed-tools: Bash(bun:*)
---

Follow work item `$1` from this worktree, so that when it moves, its contract delta and head SHA are injected into this
session's context.

Run: `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts follow $1`

Report the result in one line.
