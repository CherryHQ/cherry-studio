---
name: agent-notes
description: Use when deciding whether a Cherry Studio change needs an Agent Note, authoring or reviewing a Spec, recording a durable bug-fix decision, moving a note between proposed/implemented/rejected, or checking supersession and stacked Spec approval.
---

# Agent Notes

Read [the Agent Note rules](../../notes/README.md) before acting. Agent Notes preserve revisitable decisions; they do not replace current code, reference docs, issues, or PR discussion.

## Classify the change

Every PR declares an Agent Note or an explicit `N/A` reason.

- Use `N/A` for a local or mechanical edit that restores an existing contract without a durable tradeoff.
- Write an implemented `bug-fix` note in the same PR when the repair changes failure, compatibility, security, concurrency, atomicity, lifecycle, or another choice likely to be reversed without its root cause.
- Start substantial feature, architecture, process, and simplification work with a proposed Spec.

## Check the active tree first

Search by domain terms, mechanism names, paths, and rejected alternatives. Classify the result as new, same owner, partial supersession, or full supersession. Update the existing owner when possible. Partial supersessions stay active and cross-linked. Full supersession must preserve every unique rationale, alternative, consequence, and verification fact; deleting an old note requires explicit human approval.

## Spec-first stack

1. Create the bottom Spec branch and proposed bilingual note.
2. Give observable acceptance criteria contiguous `AC` IDs and a verification owner.
3. Create the Spec PR through `gh-create-pr`; `Spec PR` is `This PR`.
4. Inspect GitHub reviews and require an explicit `APPROVED` review whose commit id equals the current Spec head. Approval does not require merging.
5. After Approval, create implementation layers with `gh-stack`. Each PR links the Spec and lists its AC coverage.
6. A material behavior, ownership, AC, alternative, or risk change belongs on the Spec branch. Rebase upstack and require Approval again.
7. The final layer moves all three pair artifacts to `implemented/`, rewrites shipped reality in present tense, and maps every AC to actual evidence.

After `gh stack sync`, rerun `pnpm change:scope` against every live PR base and rerun only checks invalidated by the rewritten scope. A successful sync is not validation.

## Rejection

Only an explicit human decision moves a proposed note to rejected. Discussion, silence, and `CHANGES_REQUESTED` do not. Preserve a rejected note only when its evidence prevents a plausible repeated mistake; otherwise close the unmerged exploration without adding repository noise. Stop and close any implementation layers after rejection.

## Validation

Run `pnpm docs:check-notes`, the scoped pairing write/check, `pnpm docs:check`, and `git diff --check`. Report only evidence actually run.
