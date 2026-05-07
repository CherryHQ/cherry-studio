# Checklist Evolution

Rules for updating review checklists. Goal: keep checklists minimal and
high-signal — each item should direct AI attention to a distinct class of real
issues, not catalog every possible bug pattern.

## Step 1: Draft candidates

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

## Step 2: User confirmation

Present candidates via multi-select. Each option label is the candidate item
text. Unchecked candidates are discarded. If all are discarded, stop.

## Step 3: Insert

Insert accepted items into the checklist file at the appropriate position per the
category and priority rules above.
