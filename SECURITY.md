# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security report.** Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. That opens a private thread visible only to the maintainers.

Expect an acknowledgement within three working days and an assessment within seven.

## What is in scope

DKM answers permission prompts on its installer's behalf and publishes to GitHub, so the interesting failures are about
authority and disclosure rather than memory safety:

- **Consent laundering.** Any path from pending-event, receipt, headline or session-report content into `decide()`. The
  current engine accepts only `DecisionInput` and `Policy`
- **Escaping the policy.** A call matching a predicate in `src/decide.ts` that does not receive its documented `ask` or
  `deny` result
- **Disclosure through a receipt.** Any automatically sourced content outside the fields constructed in
  `src/hooks/stop.ts`. Narrative and blockers are publishable only after explicit CLI report commands; hooks do not read
  transcripts or unrestricted tool output into them
- **A decision that is not logged.** Every autonomous answer must be in `.dkm/decisions.jsonl` before it is returned

## What is out of scope

- The behaviour of Claude Code itself. Report those to Anthropic
- A policy that grants more than its author intended. `.dkm/policy.toml` is the human's grant, and DKM executes it as
  parsed. The blast-radius predicates in `src/decide.ts` still run first and cannot be overridden from it
- Anything requiring an attacker who can already write to your checkout. At that point they can edit the policy, and
  DKM's guarantees do not survive an untrusted local filesystem

## The property that matters most

> Auto-answering may execute an existing decision. It must never manufacture intent or consent.

A report that demonstrates DKM manufacturing consent is the most serious class we accept, and it is asserted by test as
`NFR-AUTH`.
