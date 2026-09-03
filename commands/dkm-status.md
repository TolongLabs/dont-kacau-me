---
description: Show what this worktree is bound to, what it follows, and recent autonomous decisions
allowed-tools: Bash(bun:*)
---

Run: `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts status`

Show the output verbatim. Then, in at most two sentences, say whether anything looks like it needs the human:
undelivered pending events, or decisions whose rule begins `blast:`.
