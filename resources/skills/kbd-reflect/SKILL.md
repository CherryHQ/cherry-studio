---
name: kbd-reflect
description: Use to generate the phase reflection report after all changes in a KBD phase are complete — goal achievement, delivered changes, artifact quality summary, technical debt, lessons captured, and recommended focus for the next phase. Seeds the next phase's planning inputs.
---

# /kbd-reflect

Run the **Reflect** phase of the KBD lifecycle.

## What this does

Generates `.kbd-orchestrator/phases/<phase-name>/reflection.md` summarizing:

- Goal achievement percentage (MET / PARTIAL / NOT MET per goal)
- Delivered changes (from progress.json and archive)
- **Artifact quality summary** (from artifact-refiner logs, when installed)
- Technical debt introduced
- Lessons captured for the knowledge base
- Recommended focus for next phase

## Artifact Quality Summary

When `artifact-refiner` is installed, aggregate its results from all changes
in the phase:

1. **Read refinement logs** — `.refiner/artifacts/<change-id>/refinement_log.md`
   for each change in `progress.json`
2. **Compute pass rate** — `changes_passed / total_changes`
3. **List constraint violations** — group by constraint name, count occurrences
4. **Identify recurring patterns** — constraints that failed across 2+ changes

Include in `reflection.md` under `## Artifact Quality Summary`:

```markdown
## Artifact Quality Summary

| Metric                       | Value     |
| ---------------------------- | --------- |
| Changes with QA              | 8/10      |
| First-pass pass rate         | 6/8 (75%) |
| Changes requiring refinement | 2         |
| Total refinement iterations  | 5         |

### Recurring Constraint Violations

- `no-any-types`: 3 changes (change-002, change-005, change-007)
- `test-coverage-80`: 2 changes (change-003, change-008)
```

## Prerequisites

All changes for this phase must be:

- Implemented (`implementation_status: COMPLETE` in `progress.json`)
- QA gate passed (when `artifact-refiner` is installed, unless skipped)
- If OpenSpec: verified (`/opsx:verify`) and archived (`/opsx:archive`)
- If native KBD: moved to `.kbd-orchestrator/changes/archive/<date>-<id>/`

These are separate prerequisites: implementation completion drives the N/N
counter, while QA, verification, and archival drive evidence, certification,
and publication/lifecycle fields.

## Progress Signals (MANDATORY)

**FIRST tool call of every turn:** Read `.kbd-orchestrator/position-reminder.txt` (if it exists) to get the current phase, step N of T, and next command. If that file is absent, read `.kbd-orchestrator/current-waypoint.json`.

Before any other action, emit to plain response text (BEFORE any tool call):

```
Starting kbd-reflect — <phase-name> (step N of T)
```

When all steps are complete, emit:

```
Completed kbd-reflect — <phase-name> (step N of T)
```

**How to get N and T (MANDATORY — never estimate):** read
`completion.implementation.completed`/`.total` from `progress.json` via
`implementationCompleted(progress)`/`implementationTotal(progress)`
(`lib/kbd/progress.mjs`), falling back to `current-waypoint.json`'s
`implementationCompleted`/`implementationTotal` when `progress.json` is
absent.

Use the canonical phase name from the argument or `current-waypoint.json`. Emit to plain response text — no tool call needed.

## How to invoke

1. **Discover project identity**
2. **Confirm the active phase** — from argument or waypoint
3. **Read `progress.json`** — incorporate work done by all tools
4. **Read artifact-refiner logs** — aggregate QA results, when installed
5. **Load all change data** — from `openspec/changes/archive/` if OpenSpec,
   or `.kbd-orchestrator/changes/archive/` if native KBD
6. **Write reflection** to `.kbd-orchestrator/phases/<phase>/reflection.md`
7. **Advance the waypoint** to the next phase
8. **Trigger**: report that reflection is complete and the next step is to
   advance to a new phase

## Examples

```
/kbd-reflect                             # uses active waypoint phase
/kbd-reflect phase-1-foundation          # explicit phase name
```

## Hook integration

`/kbd-reflect` is the canonical *phase-end* boundary. After the reflection
report is written, fire `reflect:after`, then immediately fire `phase:after`
for the closing phase, via `hooksFire('reflect'|'phase', 'before'|'after', name, index, total, ctx)`
from `lib/kbd/hooks.mjs`. `phase:before` for the *next* phase is fired when a
new phase is started, not here.

The bottleneck-guard evaluation (`evaluateBottleneck`/`isBottleneckActive` from
`lib/kbd/bottleneck-guard.mjs`) and any phase-transition write both need to
succeed before `phase:after` fires — this ordering prevents a rejected or
partial reflection from producing a completion memory record:

```js
import { hooksFire } from '../../lib/kbd/hooks.mjs';
import { isBottleneckActive, evaluateBottleneck } from '../../lib/kbd/bottleneck-guard.mjs';

await hooksFire('reflect', 'before', phase, 1, 1, { orchestratorRoot, cwd, runCommand });
// … write reflection.md …
await hooksFire('reflect', 'after', phase, 1, 1, { orchestratorRoot, cwd, runCommand });

const guardEnabled = isBottleneckActive(cwd);
if (guardEnabled) {
  const preTransition = evaluateBottleneck('phase', 'after', phase, true, { root: cwd });
  if (preTransition.status !== 0 && preTransition.status !== 2) throw new Error(preTransition.stderr);
}

// … record the phase transition to complete, e.g. via the project's own
//     phase-completion write path …

if (guardEnabled) {
  const postTransition = evaluateBottleneck('phase', 'after', phase, false, { root: cwd });
  if (postTransition.status !== 0 && postTransition.status !== 2) throw new Error(postTransition.stderr);
}

await hooksFire('phase', 'after', phase, 1, 1, { orchestratorRoot, cwd, runCommand }); // canonical phase-end boundary
```

See the parent `kbd-process-orchestrator` skill's "Hooks" section for taxonomy
and payload.

## Stage gate & handoff

The reflect gate requires the execute handoff. After the reflection report
is written, record the closing handoff — the next phase's assess stage seeds
from it plus `reflection.md`:

```js
import { stageGate, stageHandoffWrite } from '../../lib/kbd/stage-gate.mjs';

const gate = stageGate('reflect', { cwd });
if (gate.status !== 0) throw new Error(gate.stderr);

// … write reflection.md …

stageHandoffWrite(
  'reflect',
  '<1–3 sentences: deltas found, corrective actions, recommended next phase>',
  ['reflection.md'],
  { cwd },
);
```

Phases without a `handoffs/` directory are legacy: `stageGate` warns and still
passes. A deliberate stage skip is recorded with
`stageHandoffSkip('reflect', '<reason>', { cwd })`.
