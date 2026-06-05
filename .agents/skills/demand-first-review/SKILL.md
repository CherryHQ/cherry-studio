---
name: demand-first-review
description: Use when reviewing a PR, API, IPC channel, endpoint, parameter, type, or config that adds new surface area — BEFORE commenting on implementation quality. Also use immediately when a review surfaces signals like "no consumers yet", "unused export", "speculative", "additive", "forward-compatible", or "for future use".
---

# Demand-First Review

## Overview

In engineering, the first-principles starting point is the **demand** (the requirement). The biggest waste in review is providing high-quality polish suggestions for something that should not exist. First audit whether the demand is real (**consumer archaeology**); only review the implementation of what survives.

**Iron ordering** (the first three steps of Musk's five-step algorithm): question the requirements → delete → only then simplify/optimize. Reversing the order = optimizing something that should not exist.

## Consumer Archaeology (core workflow)

For every newly added API / channel / parameter / type / field:

1. **List consumers**: trace ALL real call sites across branches and repos (`git grep` including feature branches). Do not trust the PR description.
2. **Measure consumption**: for each consumer, check **which part of the return value / capability it actually reads**. Consumer count ≠ consumption; a consumer that only reads one boolean consumes zero of an error taxonomy. Real consumption = the real size of the demand.
3. **Judge pseudo-demand** — two checks, both required:
   - **Zero consumption** → pseudo-demand;
   - **Non-zero consumption but policy**: does this dimension move a judgment the consumer could compute in one line into the contract (e.g. an `expectedKind` param vs. "read `kind` and compare")? Contracts carry facts; policy inlines back into consumers — **delete even when it has real readers**.

   Either hit → **challenge the whole dimension instead of polishing it**.
4. **Check same-source capability**: does an existing API already cover this, including "strict projection" relations (e.g. `getFileSize ≡ getMetadata().size`)? Never open a second entry point for the same capability.
5. **Check responsibility**: is the demand leaked from another layer (e.g. renderer interpreting fs errors, UI doing business validation)? Check-then-act queries usually should become try-the-operation.

After each question eliminates a layer, apply normal implementation review (validation, tests, types, docs) **only to the survivors**.

## Rationalization Table

| Excuse | Reality |
|---|---|
| "The API is clean / the types are elegant" | A clean thing that shouldn't exist still shouldn't exist. Question existence first. |
| "It has consumers" | Counting isn't enough. Check which fields each consumer reads — a zero-consumption dimension is still pseudo-demand. |
| "This parameter/field IS consumed" | Consumed ≠ should exist. Second check: fact or policy? A dimension that moves a one-line consumer-side judgment into the contract gets inlined back, readers or not. |
| "Found an unused export — add a test for safety" | Zero-consumption signals should trigger demand questioning, not test backfill. |
| "A technical constraint makes it necessary" | Ask whether the demand served by that constraint is itself real. Constraints are not axioms. |
| "The PR is additive, it breaks nothing" | Additive is exactly how pseudo-demands sneak in. New surface needs MORE existence scrutiny than modified surface. |
| "We may need it later / forward-compatible" | Zero consumption now means pseudo-demand now. Add it when a real consumer appears. |
| "Existence is the author's / architect's call" | Questioning demand is part of review. Downgrading existence questions to nits equals not asking. |

## Red Flags — stop, return to step 1

- You have written five implementation-level comments without listing consumers
- Your report says "speculative" / "no consumers yet" / "unused" but concludes keep / note / add test
- You are finding reasons for an API to exist instead of finding its consumers
- You are about to suggest "add a comment explaining why this is needed" — first confirm it is needed

## Real-World Impact

PR #15695 (2 new IPC channels): six implementation-level review agents produced 30+ polish comments, zero questioning existence. Three consumer-archaeology questions later: one channel rejected as a duplicate entry point, one parameter deleted, one channel classified as debt-to-remove — invalidating most of the polish comments.
