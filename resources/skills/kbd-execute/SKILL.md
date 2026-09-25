---
name: kbd-execute
description: Use to select an execution backend for the active KBD phase, write canonical phase execution state, dispatch the phase, and maintain KBD as the source of truth. Supports multi-tool handoff via the progress.json protocol.
---

# /kbd-execute

Run the **Execute** phase of the KBD lifecycle.

## What this does

Reads `.kbd-orchestrator/phases/<phase-name>/plan.md`, selects the best
execution backend (tool or OpenSpec), writes `execution.md`, and dispatches the
phase while keeping KBD as the source of truth.

Dispatch begins Execute; it does not complete it. Write the backend contract
in `execution.md` and a dispatch receipt at
`.kbd-orchestrator/phases/<phase>/execute-dispatch.json` with the actual
dispatch time, assigned changes, and pending work. This receipt is not a stage
handoff: do not give it `completedAt` or `nextStage: reflect`, and do not place
it at `handoffs/execute.handoff.json`.

Keep the parent Execute stage active while delegated or local work runs. Use
`kbd-apply` task boundaries and typed KBD mutations; the runtime refreshes
progress and waypoint projections. Resume from actual canonical work state,
not the existence of a dispatch artifact.

## Final phase QA gate

Do not run tests, verification builds, artifact refinement, or adversarial review
after individual tasks or changes. Complete every planned production change first.
When the active harness provides an agent team, assign implementation to executor
roles and keep reviewer, auditor, verifier, and integration-checker roles dormant
until every production change is complete. Then run one production-path integration
gate and one cumulative artifact/adversarial review. The result is evidence and
certification state; it must not reopen the implementation counter:

```
all phase implementation complete via typed KBD transitions (projected in progress.json)
  │
  ├─ artifact validation for "<change-id>" (artifact-refiner, if installed)
  │
  ├─ ALL PASS → diff-mode adversarial review for "<change-id>" (if installed)
  │   │
  │   ├─ verdict PASS → proceed to archive
  │   │   ├─ if OpenSpec: kbd-apply verify → kbd-apply archive
  │   │   └─ if native: kbd-apply verify → kbd-apply archive
  │   │   (WARNING findings: logged in the review dir, archive proceeds;
  │   │    SUGGESTION: informational)
  │   │
  │   └─ verdict BLOCK (any CRITICAL) → record certification BLOCKED through typed KBD commands
  │       └─ fix, then re-run only the failed final gate
  │
  └─ ANY FAIL → record certification BLOCKED, fix, then re-run only the failed final gate
```

### Local review coverage

File-count and documentation-only skips do not exist. QA and adversarial review
cover the cumulative phase diff. They never interrupt production implementation.
Skipping either final gate records `pending_review`; final local certification
still requires a completed receipt or an explicit, signed waiver.

## Progress Signals (MANDATORY)

**FIRST tool call of every turn:** Read `.kbd-orchestrator/position-reminder.txt` (if it exists) to get the current phase, step N of T, and next command. If that file is absent, read `.kbd-orchestrator/current-waypoint.json`.

Before any other action, emit to plain response text (BEFORE any tool call):

```
Starting kbd-execute — <phase-name> (step N of T)
```

Only after the execute completion checklist below is satisfied, emit:

```
Completed kbd-execute — <phase-name> (step N of T)
```

**How to get N and T (MANDATORY — never estimate):** read
`completion.implementation.completed`/`.total` from `progress.json` via
`implementationCompleted(progress)`/`implementationTotal(progress)`
(`lib/kbd/progress.mjs`), falling back to `current-waypoint.json`'s
`implementationCompleted`/`implementationTotal` when `progress.json` is
absent.

When executing a named sub-phase within a multi-phase plan, emit the phase-level signal BEFORE the first change signal — even when the orchestrator is not present:

```
Starting phase <N> out of <total>: <sub-phase-name>
```

After all changes in that sub-phase satisfy the execute completion checklist:

```
Completed phase <N> out of <total>: <sub-phase-name>
```

Additionally, emit before and after each individual change (read canonical
`completion.implementation` from `progress.json`; legacy counters are fallback
aliases only — never guess and never use evidence-task completion):

```
Starting change <N> of <total>: <change-id>
Completed change <N> of <total>: <change-id>
```

When the code/integration contract for a change is complete, update the ledger
atomically with `markImplementationComplete(progressFile, changeId, ctx)` from
`lib/kbd/progress.mjs`:

```js
import { markImplementationComplete } from '../../lib/kbd/progress.mjs';

await markImplementationComplete(
  '.kbd-orchestrator/phases/<phase>/progress.json',
  '<change-id>',
  { hooksFire },
);
```

This transition does not mark evidence, certification, or publication complete.
Never postpone it merely because those independent dimensions are pending.

Use the canonical phase name from the argument or `current-waypoint.json`. Phase and change totals must come from `progress.json` or the plan — never guessed. Emit to plain response text — no tool call needed.

## How to invoke

1. **Discover project identity** — read `.kbd-orchestrator/project.json` or infer
2. **Confirm the active phase** — from argument or waypoint
3. **Load waypoint** — `.kbd-orchestrator/current-waypoint.json` first when it exists
4. **Load assessment and plan** for the phase
5. **Write `execution.md`** with selected backend + dispatch contract
6. **Record the active path** through typed KBD commands; projections refresh automatically
7. **Register planned changes and tasks** through `prometheus kbd change register` / `task register`
8. **Dispatch** and write `execute-dispatch.json`; keep Execute active
9. Complete every planned production change without intermediate verification
10. Run one production-path integration gate and one cumulative final review
11. Verify and archive changes through `kbd-apply` after the final phase gates pass
12. **Complete Execute only at the phase boundary** — use the checklist below; dispatch is not completion

## Backend Types

| Backend       | When to use                                                |
| ------------- | ---------------------------------------------------------- |
| `openspec`    | OpenSpec available; spec-backed traceability required      |
| `native-tool` | Tool has explicit planning, inspectable progress           |
| `hybrid`      | Native tool for decomposition, OpenSpec for spec execution |
| `manual`      | Human-only operation; no automation possible               |

## Examples

```
/kbd-execute                             # uses active waypoint phase
/kbd-execute phase-2-sales-module        # explicit phase name
/kbd-execute --skip-qa                   # skip the artifact QA gate
/kbd-execute --skip-adversarial-review   # skip the adversarial review gate
```

## Hook integration

Fire `execute:before` when entering Execute, before selecting a backend.
Fire `execute:after` only at the completed Execute boundary described below,
never after merely writing `execution.md` or dispatching work. Use
`hooksFire('execute', 'before'|'after', name, index, total, ctx)`
from `lib/kbd/hooks.mjs`. **`task:before`/`task:after` are fired per task by
the change-apply driver (`kbd-apply`'s scope)** — not by `/kbd-execute` and
not by bare OpenSpec apply. `/kbd-execute` writes the dispatch contract; the
apply driver walks the tasks, firing the per-task hooks and emitting the
plain-text position signal on each boundary.

```js
import { hooksFire } from '../../lib/kbd/hooks.mjs';

await hooksFire('execute', 'before', phase, 1, 1, { orchestratorRoot, cwd, runCommand });
// … write execution.md and execute-dispatch.json; drive the assigned work …
// No execute:after or execute completion handoff at dispatch.
```

Note: the `on_change_complete` legacy alias is fired automatically by
`hooksFire` on the **final** `task:after` of each change (sentinel:
`index === total`, matching `kbd_hook_index == kbd_hook_total`). Projects
relying on `on_change_complete` continue to work without changes.

## Execute completion checklist

Before completing Execute, inspect the active phase’s canonical state and
actual evidence. All of the following must hold:

1. Every change and task assigned to this phase’s execution scope is complete;
   none remains pending, in progress, or blocked. Completion of one delegated
   change does not complete the parent stage.
2. The cumulative phase satisfies the single final integration, QA and independent
   review gates, with real receipts or an explicitly permitted signed waiver. A
   skip flag or `pending_review` is not a passing result. Per-change QA is forbidden.
3. Required `kbd-apply verify` and `kbd-apply archive` operations have
   succeeded for every applicable change, including any reconciliation work
   assigned to this phase. Record actual outcomes and evidence locations.

If anything remains, report it and keep Execute active. Implementation N/N
alone does not satisfy this checklist. Do not infer success from a dispatch
receipt, a missing tool, or a previous completion claim.

Once all conditions hold, record the completed execute stage with a typed
`prometheus kbd stage transition`, fire `execute:after`, inspect its actual
outcome under project hook policy, and then write the completion handoff.
Required hook failures must be resolved before handing off to Reflect.
Preserve actual earlier receipts; never manufacture a successful past hook.

## Stage gate & handoff

At dispatch, require the plan handoff and write only dispatch artifacts:

```js
import { stageGate } from '../../lib/kbd/stage-gate.mjs';

const gate = stageGate('execute', { cwd });
if (gate.status !== 0) throw new Error(gate.stderr);

// … enter Execute with a typed command, write execution.md and execute-dispatch.json …
// Keep Execute active; do not write its completion handoff here.
```

Only after the completion checklist and required hook outcomes above are
satisfied, invoke:

```js
import { stageHandoffWrite } from '../../lib/kbd/stage-gate.mjs';

stageHandoffWrite(
  'execute',
  '<completed phase scope; QA/review and verify/archive evidence>',
  ['execution.md', 'progress.json'],
  { cwd },
);
```

This completion handoff is what Reflect reads first. Its `completedAt` and
`nextStage` describe a completed Execute boundary, never dispatch readiness.

A missing `handoffs/` directory does not bypass required predecessors.
A missing required handoff fails with remediation: complete the predecessor
stage, or record an explicit skip with its reason under project policy.
A deliberate stage skip is recorded with
`stageHandoffSkip('execute', '<reason>', { cwd })`.
