## What this changes

<!-- Lead with what is different now. One or two sentences. -->

## Why

<!-- The problem, not the patch. Link the issue: Closes #N -->

## Testing

- [ ] `bun run lint`, `bun run typecheck` and `bun test` all pass
- [ ] New assertions pin the **harness's** contract, not this code's own output shape
- [ ] Every new test was **mutation-tested**: the thing it checks was broken, the test failed, the break was reverted

<!-- Name the mutations you ran and confirm they were caught. A test that has never been seen to fail is decoration. -->

## If behaviour changed

- [ ] `docs/TRD.md` matches the new behaviour
- [ ] `docs/README.md` matches it too, wherever it described the same thing
- [ ] A defect found but not fixed here has been filed as an issue, and listed as a limitation if a user would hit it

## Authority

- [ ] This adds no code path from anything DKM ingests to a permission decision
