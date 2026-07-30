# Checklist Evolution

Rules for evolving review checklists without confusing a review-session
suggestion with durable repository knowledge. Goal: keep checklists minimal
and high-signal — each item should direct AI attention to a distinct class of
real issues, not catalog every possible bug pattern.

## State model

- **Proposed**: a valid candidate drafted from a recurring uncovered pattern
  and recorded in the review report. No checklist file is edited.
- **Accepted**: a user explicitly selects a proposed candidate during a
  separately authorized checklist-maintenance flow. Acceptance authorizes the
  rule choice, not an implicit commit, push, or PR.
- **Persisted**: an accepted rule has been written to the canonical tracked
  checklist in a user-designated long-lived checkout and captured in a durable
  repository record such as a commit or PR. Only this state may be described as
  available to subsequent reviews.

The canonical storage is the appropriate tracked checklist under
`.agents/skills/gh-pr-review/references/` — normally `code-checklist.md` or
`doc-checklist.md`. Never treat runtime memory, a report, or an uncommitted file
as canonical storage.

## Step 1: Draft proposed candidates

For each uncovered pattern, draft a candidate item. ALL rules below MUST be
satisfied — violation makes the candidate invalid:

1. One assertive phrase describing the expected state (not a question)
2. Generic: applies across files, not tied to a specific variable, function, or bug
3. Atomic: one checkable concern per item (not "X and Y")
4. No overlap: if the issue is a specific case of an existing item, do NOT add it
5. Place under the most specific existing category; create a new category only when
   no existing one fits
6. Each category stays within 3–8 items. Below 3, merge into a related category.
   Above 8, first try merging overlapping items; only split if each resulting
   sub-category has a distinct focus expressible in 2–3 words
7. Prefer fewer, broader items — the checklist is a prompt for attention directions,
   not an exhaustive bug catalog

When uncertain whether a new item overlaps with an existing one, do NOT add it.

During a regular local, teams, or PR review, include every valid candidate in
the final report as **Proposed**, with its target checklist and category. Stop
there: do not prompt for selection, edit a checklist, or claim persistence.

## Step 2: Accept in an explicit maintenance flow

Continue past Step 1 only when the user explicitly requests checklist
maintenance or asks to adopt proposed candidates. Present the candidates for
selection. Unselected candidates remain proposed or are discarded; selected
candidates become **Accepted**.

Acceptance does not authorize writing into a temporary PR review worktree. The
maintenance flow must identify a user-designated persistent checkout and
target branch. If either is unclear, ask before editing rather than guessing.

## Step 3: Write accepted rules

Insert accepted items into the canonical checklist file in the designated
persistent checkout at the appropriate position under the category and
priority rules above. Never write them into `REVIEW_DIR` or another disposable
worktree. At this point the rules are accepted and written, but not yet
persisted.

## Step 4: Create the durable record

Commit, push, or open a PR only with the authority required by the repository's
normal publish workflow. Record the target branch and resulting commit or PR in
the maintenance report. After that durable record exists, mark the rules
**Persisted**. If publication was not authorized or fails, report them as
accepted but not persisted.
