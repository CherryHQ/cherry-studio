# Diagnosis

Analyze the most recent `/gh-pr-review` session in this conversation to find
defects in the skill files themselves — checklist gaps, ambiguous instructions,
missing exclusion rules, etc. The goal is to make the skill more accurate and
reliable, NOT to re-review the project code.

Work entirely from the session context. Only read a skill file when you need to
confirm the exact wording of a rule before suggesting a change.

## Prerequisites

If no `/gh-pr-review` session exists in the current conversation, inform the
user and stop.

## Analyze

Scan the **entire** session from start to finish for these signals and report
findings. Do not stop after finding the first issue — exhaustively check every
user message and system notification. Key evidence includes user rollbacks of
auto-fixes, manual corrections or overrides the user had to provide, steps the
AI deviated from, and user interventions to unblock a stalled flow (e.g., the
user asking "why did you stop?" or manually prompting the AI to continue). For
each finding, state which skill file to change and what the change should be.

### False positives

Issues reported or auto-fixed that the user rejected, reverted, or corrected.
For each: what was wrong, and which checklist item, exclusion rule, or
judgment-matrix rule should be added or revised.

### Judgment errors

Issues where the user disagreed with the risk level or worth-fixing decision
(e.g., reverted an auto-fix, or explicitly overrode a skip). For each: what
the session assigned vs what it should have been, and how to revise
judgment-matrix.md.

### Flow deviations

Steps the AI skipped, reordered, or executed incorrectly. For each: which
step in which file was violated, and how to clarify the instruction.

### Other improvements

Anything else observed in the session that points to a concrete skill file
change — e.g., redundant steps, missing guardrails, unclear wording. Only
include if the change is specific and actionable.

## Apply

If any finding has a concrete file edit, present all actionable edits via
multi-select. Each option label is a one-line summary of the edit. Unchecked
edits are discarded.

Apply selected edits.
