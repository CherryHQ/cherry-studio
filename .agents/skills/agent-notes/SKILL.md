---
name: agent-notes
description: Use when deciding whether a Cherry Studio change needs an Agent Note, authoring or reviewing a Spec, recording a durable bug-fix decision, moving a note between proposed/implemented/rejected, or checking supersession and stacked Spec approval.
---

# Agent Notes

Read [the Agent Note rules](../../notes/README.md) before acting. Agent Notes preserve revisitable decisions; they do not replace current code, reference docs, issues, or PR discussion.

## Classify the change

Every human-authored PR declares an Agent Note or an explicit `N/A` reason. Automation-authored PRs (repository workflows and Dependabot) are exempt from this metadata requirement, not from normal validation.

The class names the decision's subject; it does not force every note to start as proposed. Choose the initial lifecycle from whether the target needs human agreement before implementation and whether the decision has already shipped.

- Use `N/A` for a local or mechanical edit that restores an existing contract without a durable tradeoff.
- Write an implemented `bug-fix` note in the same PR when the repair changes failure, compatibility, security, concurrency, atomicity, lifecycle, or another choice likely to be reversed without its root cause.
- A small, completed testing or other durable decision that does not meet the Spec-first threshold may enter its owning class as implemented.
- Start substantial feature, architecture, process, and simplification work with a proposed Spec.
- Start any class as proposed when behavior, ownership, ACs, alternatives, or risks need human agreement before implementation.

## Check the active tree first

Search by domain terms, mechanism names, paths, and rejected alternatives. Classify the result as new, same owner, partial supersession, or full supersession. Update the existing owner when possible. Partial supersessions stay active and cross-linked. Full supersession must preserve every unique rationale, alternative, consequence, and verification fact; deleting an old note requires explicit human approval.

There is no `archived/` lifecycle yet. Do not archive by age, merge status, moved code, or stale wording. Keep current owners factual; keep fully superseded notes active and cross-linked until a separately approved archive design provides active-first search, successor discovery, and matching gates.

## Spec-first stack

1. Create the bottom Spec branch and proposed bilingual note.
2. Give observable acceptance criteria contiguous `AC` IDs and a verification owner.
3. Create the Spec PR through `gh-create-pr`; `Spec PR` is `This PR`.
4. Inspect GitHub reviews and require an explicit `APPROVED` review whose commit id equals the current Spec head. Approval does not require merging.
5. After Approval, create implementation layers with `gh-stack`. Each PR links the Spec and lists its AC coverage.
6. A material behavior, ownership, AC, alternative, or risk change belongs on the Spec branch. Rebase upstack and require Approval again.
7. The final layer moves all three pair artifacts to `implemented/`, rewrites shipped reality in present tense, and maps every AC to actual evidence.

Before deciding step 7, run `gh stack view --json`. Exit code 2 means the branch is standalone. Otherwise inspect the current layer and every downstack implementation PR, then aggregate only ACs backed by verification that was actually run. Intermediate layers keep the note proposed; only the final layer whose cumulative evidence covers every approved AC performs the transition. Do not infer finality from branch order alone.

After `gh stack sync`, rerun `pnpm change:scope` against every live PR base and rerun only checks invalidated by the rewritten scope. A successful sync is not validation.

## Rejection

Only an explicit human decision moves a proposed note to rejected. Discussion, silence, and `CHANGES_REQUESTED` do not. Preserve a rejected note only when its evidence prevents a plausible repeated mistake; otherwise close the unmerged exploration without adding repository noise. Stop and close any implementation layers after rejection.

## Validation

For a lifecycle move, run `pnpm agent-notes:check-transition --base <verified-spec-ref>` in addition to `pnpm docs:check-notes`, the scoped pairing write/check, `pnpm docs:check`, and `git diff --check`. The transition checker validates the declared direction and AC mapping; it never decides rejection or stack completion. Report only evidence actually run.
