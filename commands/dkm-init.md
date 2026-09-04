---
description: Set DKM up in this repository — check the prerequisites and write a starter policy
argument-hint: "[--force]"
allowed-tools: Bash(bun:*)
---

Run: `bun "${CLAUDE_PLUGIN_ROOT}"/src/cli.ts init $1`

**The human cannot see that command's output.** The harness collapses it to a single line, so anything you do not put in
your own reply is lost, and this is the one command whose whole value is what it prints. Write the following into your
reply as text:

1. Any check that failed, and the command that fixes it. Say what it blocks: `gh` missing or unauthenticated, or no
   GitHub remote, blocks receipts only, and the policy half works without any of them.
1. Where the policy file was written, or that one already existed and was left alone.
1. What is now automatic, and what still reaches them anyway. Keep both lists.
1. The next step: read the file, delete anything they did not mean to grant, commit it.

Then stop. Do not edit `.dkm/policy.toml` yourself. It is the human's grant, and widening it on their behalf is the one
thing DKM must never do. If they want a change, name the lines to edit and why.
