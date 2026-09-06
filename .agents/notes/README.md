# Agent Notes

English | [中文](README.zh.md)

An Agent Note records a decision a maintainer may reasonably revisit: the problem, the chosen behavior, what alternatives lost, the accepted cost, and the evidence that makes the result complete. It is repository rationale, not authority over current code.

## Layout and classification

Notes live at `{lifecycle}/{class}/yyyy-mm-dd-topic.md`.

Lifecycle:

- `proposed/` — a Spec awaiting or carrying approval; implementation is incomplete.
- `implemented/` — shipped reality, kept factually current.
- `rejected/` — an explicitly declined proposal retained only while its rationale prevents a plausible repeated mistake.

Class:

| Class | Use |
|---|---|
| `feature` | User- or model-facing capability. |
| `bug-fix` | Durable root cause and repair decision. |
| `simplification` | Removal or collapse of existing behavior or structure. |
| `architecture` | Shipped source ownership and dependency decisions. |
| `process` | Repository tooling, policy, and workflow. |
| `testing` | Test infrastructure and strategy. |

There is no `refactor` class. A refactor with a durable removal decision is a simplification; a mechanical refactor needs no note.

## When a note is required

Every PR declares an Agent Note or an explicit `N/A` reason in the PR template. A note is required for architecture choices, cross-module contracts, disk/configuration/wire formats, process policy, substantial features, and alternatives likely to be reconsidered.

A simple bug fix uses `N/A` when it restores an existing documented contract without introducing failure semantics, ownership, compatibility, or a durable tradeoff. It writes an implemented `bug-fix` note when the repair chooses among plausible alternatives, changes a persistent contract, protects security/concurrency/atomicity/lifecycle, or could reasonably be reverted by a future maintainer who lacks the root cause.

Prefer updating the note that already owns the decision. Do not add one note per commit or repeat PR narration.

## Spec-first stack

Substantial feature, architecture, process, and simplification work follows this sequence:

1. Create a bottom Spec PR containing a proposed bilingual Agent Note.
2. Give every acceptance criterion a stable `AC1`, `AC2`, ... identifier and name its verification owner.
3. Wait for an explicit human Approval on the current Spec head; merging the Spec first is optional.
4. Stack implementation PRs on that branch. Each layer links the Spec and lists the AC IDs it covers.
5. Put material behavior, ownership, AC, alternatives, or risk changes on the Spec branch; rebase the stack and obtain Approval again.
6. Keep the note proposed through intermediate layers.
7. The final layer that satisfies all ACs moves and rewrites the note as implemented.

Approval binds one exact Spec head. Silence, `CHANGES_REQUESTED`, and discussion do not mean rejection.

## File format

Every note starts with this exact header block, followed by the language switcher:

```markdown
# Agent Note: <title>

Status: <lifecycle>

English | Chinese counterpart: yyyy-mm-dd-topic.zh.md
```

A proposed note contains:

```markdown
## Problem
## Proposal
## Alternatives considered
## Acceptance criteria
## Risks
```

Acceptance criteria are observable outcomes, not implementation tasks:

```markdown
- AC1 — <observable result> (verification: unit | renderer | Electron | packaged artifact | docs gate)
```

An implemented note contains:

```markdown
## Problem
## Decision
## Alternatives considered
## Consequences
## Verification
```

Transitioned Specs map every AC to actual evidence. A direct bug-fix note may use `Regression` instead:

```markdown
- AC1 — `<command or test>`: <what regression it catches>
- Regression — `<command or test>`: <what regression it catches>
```

A rejected note retains `Problem`, `Proposal`, and `Alternatives considered`, adds `Rejection rationale`, and uses:

```markdown
Status: rejected — <one-line decisive reason>
```

## Rejection and deletion

Only an explicit human decision moves `proposed` to `rejected`. A partial rejection amends the proposed note and requires new Approval; a discussion alternative stays inside `Alternatives considered`.

If the rejection rationale prevents a likely repeated mistake, convert and merge the rejected note before closing its Spec PR. If the exploration has no durable value, close the unmerged PR without adding repository noise. An implemented decision is never relabeled rejected; a new note supersedes it.

## Supersession

Before adding a note, search active notes by domain terms, mechanism names, paths, and rejected alternatives.

- New decision: create a note.
- Same decision: update the current owner.
- Partial supersession: keep both notes current and cross-link them.
- Full supersession: move every unique rationale, alternative, consequence, and verification fact into the new owner. Deleting the old note requires explicit human approval.

Do not rewrite a note into a different decision or use Git history as the only remaining rationale.

## Lifecycle transitions

`proposed → implemented` is a rewrite to shipped present tense: `Proposal` becomes `Decision`; plans and checklists become actual `Consequences` and `Verification`. Move the English file, Chinese file, and sidecar together.

`proposed → rejected` preserves what was considered, adds the explicit verdict and evidence, and stops every implementation layer. A later proposal with new evidence links the rejected record rather than erasing it.

Implemented notes keep paths, names, defaults, ownership, failures, and verification current. When implementation and a note disagree, determine whether the code is wrong or the factual realization changed; do not preserve a worse implementation merely to satisfy stale prose.

## Pairing and gates

Every note and this README follow [the bilingual pairing contract](../../docs/i18n/README.md). Agent instruction files remain English-only.

Run:

- `pnpm docs:check-notes` for format and lifecycle structure.
- `pnpm docs:check-pairing <pair>` while editing a pair.
- `pnpm docs:check` before publishing documentation changes.

The [documentation-governance Spec](proposed/process/2026-08-18-docs-governance-and-spec-workflow.md) owns the rollout decision.
