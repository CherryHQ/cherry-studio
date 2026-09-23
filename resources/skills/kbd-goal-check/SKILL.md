---
name: kbd-goal-check
description: Use after each execution turn within a goal-driven KBD phase to evaluate whether the active phase's stopping condition has been met, without the implementer agent grading its own work — returns PASS (with evidence) or CONTINUE (with the next action). Implements the maker-is-not-evaluator pattern for harnesses whose loop is a queue rather than a condition-based loop.
---

# /kbd-goal-check

Evaluate whether the active KBD goal phase's stopping condition is met.
Invoke this after each execution turn — before deciding whether to continue
the loop or advance to the next phase.

## Progress Signals (MANDATORY)

Before any other action, emit:

```
Starting kbd-goal-check — <goal slug>
```

When the stopping-condition assessment is complete, emit:

```
Completed kbd-goal-check — <goal slug> (status: <met|not-met>)
```

Emit to plain response text — no tool call needed.

## When to Use

- After each execution turn within a goal-driven phase
- Whenever you need an impartial check of goal completion
- Before advancing to the next phase condition

## What This Does

1. **Reads the stopping condition** from `.kbd-orchestrator/goals/<slug>/goal.json`
   → `phases[active_phase].stopping_condition`
2. **Reads current STATE.md** to understand what has been completed
3. **Checks the condition** against evidence files (test output, lint log,
   file content)
4. **Returns PASS or CONTINUE** with specific evidence

## Output Format

```
PASS
Evidence: All 23 tests in tests/ exit 0 (see .goal-run/test-output.txt line 1).
Lint: 0 errors (see .goal-run/lint-output.txt).
Stopping condition: "all tests pass, lint clean" — SATISFIED.
```

or

```
CONTINUE
Next action: task-004 (implement error handling for edge case in auth.go)
Blocker: 3 tests still failing: TestAuthExpiry, TestTokenRefresh, TestLogout
See: .goal-run/test-output.txt lines 47, 83, 112
```

## Steps to Follow

### 1. Find the active goal

Read `.kbd-orchestrator/current-waypoint.json` for its `goal_slug` field.

If no `goal_slug` is set, read `.kbd-orchestrator/goals/` to find the most
recently modified `goal.json` and check its `status == "running"`.

### 2. Read the stopping condition

Read `.kbd-orchestrator/goals/<slug>/goal.json` and locate the entry in
`phases[]` whose `status == "running"`, then read its `stopping_condition`
field.

### 3. Read STATE.md

Read `.kbd-orchestrator/goals/<slug>/STATE.md`.

### 4. Check evidence

Read the evidence files referenced by the stopping condition. Common patterns:

- **"all tests pass"** → read `.goal-run/test-output.txt`, check exit code
- **"lint clean"** → read `.goal-run/lint-output.txt`, count errors
- **"TASKS.md complete"** → read TASKS.md, count unchecked `[ ]` entries
- **"file X contains Y"** → read the file directly

### 5. Return verdict

**If PASS:**
- Write your PASS verdict and evidence to the response
- Update `.kbd-orchestrator/goals/<slug>/STATE.md`:
  append a `## Phase Complete` section: `<timestamp>: PASS — <evidence-summary>`
- The orchestrator will advance to the next phase or end the goal

**If CONTINUE:**
- Write your CONTINUE verdict with next action
- Identify the next unchecked task in TASKS.md
- The implementer agent will continue work on the next turn

## Separation of Concerns

This skill enforces **maker ≠ evaluator**: the agent that did the work should
NOT grade whether the goal is met. This skill is always a separate evaluation
step from the implementation turn.

Do NOT call this skill from within the same turn that did the implementation.
The orchestrator calls it as a separate turn.
