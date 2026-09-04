---
description: Show what this worktree is bound to, what it follows, and recent autonomous decisions
allowed-tools: Bash(bun:*)
---

Run: `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts status`

**The human cannot see that command's output**, because the harness collapses it. Reproduce it in your reply: what the
worktree is bound to, what it follows, how many events are undelivered, and the recent decisions with their rules.

Then, in at most two sentences, say whether anything needs them: undelivered pending events, or decisions whose rule
begins `blast:`.
