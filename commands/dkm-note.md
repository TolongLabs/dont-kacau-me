---
description: Record a narrative note or a blocker for the next receipt
argument-hint: [blocker] <text>
allowed-tools: Bash(bun:*)
---

Record what you want the next receipt to carry.

If the arguments begin with the word `blocker`, run:
`bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts blocker <the rest of the text>`

Otherwise run: `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts note $ARGUMENTS`

The human cannot see the command's output, so confirm in one line what you recorded and which receipt field it will
appear in.

Remember that a narrative is published as **unverified** and a blocker as **reported**. Neither is treated as fact about
the repository, so write them as claims, not as measurements.
