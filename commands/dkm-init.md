---
description: Set DKM up in this repository — check the prerequisites and write a starter policy
argument-hint: "[--force]"
allowed-tools: Bash(bun:*)
---

Run: `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts init $1`

Show the output verbatim; it is written for the reader. Then stop.

Do not edit `.dkm/policy.toml` yourself. It is the human's grant, and widening it on their behalf is the one thing DKM
must never do. If they ask for a change, tell them which lines to edit and why.

If a check failed, say in one sentence what that blocks: a missing `gh` or an unauthenticated one blocks receipts only,
and the policy half works without either.
