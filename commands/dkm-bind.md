---
description: Bind this worktree to a GitHub issue or PR so its receipts publish there
argument-hint: <issue-or-pr-number>
allowed-tools: Bash(bun:*)
---

Bind the current worktree to work item `$1`.

Run: `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts bind $1`

Report the result in one line. If it fails because `gh` cannot see the item, say so plainly and stop; do not try to
guess a different number.
