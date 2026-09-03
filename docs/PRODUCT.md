# PRODUCT.md

**Who DKM is for and why it exists.** Everything downstream cites this file.

Contents:

1. [The user](#the-user)
1. [The problem](#the-problem)
1. [Why this is possible now](#why-this-is-possible-now)
1. [The moment that sells it](#the-moment-that-sells-it)
1. [What DKM refuses to do](#what-dkm-refuses-to-do)
1. [Scope ladder](#scope-ladder)
1. [Who this is not for](#who-this-is-not-for)

## The user

**Primary: one developer running two or more Claude Code sessions in git worktrees on the same repository.** They get
value on day one with nobody else adopting anything, because their own sessions are already strangers to each other.

**Secondary: a team of two to five developers who each work that way.** Cross-developer propagation is where DKM does
something nothing else does, but it is an expansion of the single-player case, never a precondition for it.

The name is the promise. _Kacau_ is Malay for disturb. The product's success metric is **interrupts avoided**, not
messages delivered.

## The problem

Two costs fall on the human, and both scale with how well the agents work.

**Courier duty.** An agent finishes. Its developer summarises that by hand for teammates, and pastes teammates' progress
back into their own agents. Every hop loses provenance. By the time a fact reaches a second agent it is:

- prose
- detached from the commit it was true at
- no longer checkable

**Decision queue.** Sessions pause for the human. Three agents blocking on one person serialises all of them on that
person's attention, and the person becomes the slowest component in their own workflow. Worse, the human is often not
adding judgement — many blocking questions are lookups, or applications of a rule the human already wrote down.

The unifying observation: **the human was never only the decider, they were the coordination point.** Removing them
without replacing coordination produces divergence, faster. That is why DKM ships provenance before it ships autonomy.

## Why this is possible now

Claude Code exposes the exact seams this needs, verified against the installed binary:

- `PermissionRequest` fires **during** the permission flow and returns `allow`, `deny` or `ask` — the harness itself
  offers a socket for deciding instead of interrupting
- `Stop` fires at a turn boundary, where a state delta can be measured
- `SessionStart` and `UserPromptSubmit` inject their stdout into the model's context
- `WorktreeCreate` and `WorktreeRemove` give session binding a native lifecycle

DKM is not fighting the harness. It fills sockets the harness already exposes.

## The moment that sells it

Agent A changes an API on PR #81 and stops. Agent B, working a declared dependent issue in another worktree — and
possibly on another developer's machine — receives the contract delta **and the SHA it was observed at**, and adapts
without either human copying, summarising or pasting anything. Both humans can audit the same GitHub comment.

Meanwhile agent B hit four permission prompts along the way. The installer's policy cleared three of them and recorded
why. The fourth touched a migration, so it waited.

Nobody was kacau'd. Nothing was invented.

## What DKM refuses to do

The product has one hard boundary, and it is worth stating as a feature rather than a limitation.

> Auto-answering may **execute an existing decision**. It must never **manufacture intent or consent**.

Installing DKM and writing its policy is the human grant that makes autonomy legitimate. A message from another session
is not, and the harness agrees: peer messages are labelled as coming from another Claude session, and a relayed approval
claim is treated as untrusted input.

This is why DKM can be aggressive about deciding without being reckless. It is executing a policy its installer wrote,
in that installer's own sessions, and it writes down every call it makes.

## Scope ladder

- **v1** —
  - Receipts
  - three tracking tiers
  - the policy-driven decision engine
  - the decision log
- **v2** — Live mid-turn delivery, which needs a supervised watch or cross-session messaging
- **v3** — Cross-machine propagation beyond what GitHub carries, and a precedent store that learns

v1 is the whole product for one developer with several worktrees. Everything above it is an expansion.

## Who this is not for

- A developer running a single Claude Code session. There is nothing to coordinate
- A team that only synchronises at PR review. For them this genuinely is `gh notify` plus a Slack channel
- Anyone wanting an agent to decide things no human on the team has decided. DKM will not do it
