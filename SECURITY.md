# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security report.** Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. That opens a private thread visible only to the maintainers.

Expect an acknowledgement within three working days and an assessment within seven.

## What is in scope

DKM answers permission prompts on its installer's behalf and publishes to GitHub, so the interesting failures are about
authority and disclosure rather than memory safety:

- **Consent laundering.** Any path by which content DKM ingests — a receipt, an issue body, a peer session's message —
  influences a permission decision. There must be none
- **Escaping the policy.** A tool call that a blast-radius rule should have stopped and did not: writing outside the
  session's worktree, reaching `.dkm/`, touching a lockfile or `.env`, a migration, egress, or spending
- **Disclosure through a receipt.** Anything reaching a published comment that is not in the allowlisted schema. Raw
  transcripts and unrestricted tool output must never be published
- **A decision that is not logged.** Every autonomous answer must be in `.dkm/decisions.jsonl` before it is returned

## What is out of scope

- The behaviour of Claude Code itself. Report those to Anthropic
- A policy that grants more than its author intended. `.dkm/policy.toml` is the human's grant, and DKM executes it as
  written. Blast-radius rules still run first and cannot be overridden from it
- Anything requiring an attacker who can already write to your checkout. At that point they can edit the policy, and
  DKM's guarantees do not survive an untrusted local filesystem

## The property that matters most

> Auto-answering may execute an existing decision. It must never manufacture intent or consent.

A report that demonstrates DKM manufacturing consent is the most serious class we accept, and it is asserted by test as
`NFR-AUTH`.
