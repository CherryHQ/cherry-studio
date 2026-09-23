---
name: kbd-spec
description: Use to run the Spec stage of the KBD lifecycle (between Analyze and Plan) — turn an assessment and analysis into concrete, ordered changes (native-kbd spec.md + tasks.json + verification.md, or OpenSpec proposals).
---

# /kbd-spec

Run the **Spec** phase of the KBD lifecycle — between Analyze and Plan.

## What this does

Converts `assessment.md` (and `analysis.json` / `library-candidates.json` when
the Analyze stage ran) into concrete change specs that the Plan stage will
order and the Execute stage will drive one task per turn:

- **native-kbd backend** (default): writes
  `.kbd-orchestrator/changes/<change-id>/{spec.md, tasks.json, verification.md}`.
- **openspec backend**: emits `/opsx:new <change-id>` per change, producing
  `openspec/changes/<change-id>/{proposal.md, tasks.md}`.

Backend is resolved the same way `kbd-apply` resolves it
(`project.json.specBackend` → openspec → native-kbd).

## Progress Signals (MANDATORY)

Before any other action, emit:

```
Starting kbd-spec — <phase-name or argument>
```

When all change specs are written, emit:

```
Completed kbd-spec — <phase-name or argument>
```

Use the canonical phase name from the argument or `current-waypoint.json`.
Never guess. Emit to plain response text — no tool call needed.

## How to invoke

1. **Confirm the active phase** — from argument or
   `.kbd-orchestrator/current-waypoint.json`.
2. **Stage gate** — `stageGate('spec', { cwd })` from `lib/kbd/stage-gate.mjs`
   (requires the assess handoff; `analyze` is optional, so the gate walks back
   across an absent analyze handoff automatically).
3. **Read inputs** — `assessment.md`; `analysis.json` /
   `library-candidates.json` if Analyze ran (adopt/adapt candidates become
   "reuse this library" tasks, not "build it" tasks).
4. **Resolve backend** — `kbd-apply`'s detect semantics.
5. **Write change specs** — native-kbd files or `/opsx:new` per change, with a
   declared `scope:` and explicit task list each.
6. **Adversarial vet** — when `adversarial-review` is installed and
   `--skip-adversarial-review` was not passed, run it in artifact mode against
   the whole change set (every change named in the spec handoff, not one at a
   time — a spec is only coherent against its siblings; cross-change failures
   like a `tasks.json` `scope` that omits a file its tasks edit, or two changes
   editing the same file with no ordering, are invisible when reviewed in
   isolation). CRITICAL findings → revise the affected `spec.md` /
   `tasks.json` / `verification.md` and re-vet (max 2 rounds, then accept with
   an "Unresolved review findings" section appended). WARNING findings → carry
   into the stage handoff.
7. **Write handoff** — see "Stage gate & handoff" below.

> **Note on the ZeeSpec coverage gate.** The upstream version of this skill
> gates spec-writing on a `.zeespec/<subject>/` coverage verdict (GO /
> CAUTION / NO-GO) when that directory exists. This port omits that gate: it
> is documented upstream as inactive whenever no `.zeespec/` directory is
> present, and none of this project's own skills create one, so the omission
> is behavior-preserving here. If `zeespec-interrogator`-style coverage
> tracking is ever added to this project, reintroduce the gate at this point
> in the flow — after reading inputs, before writing change specs.

## Hook integration

Fires `spec:before` / `spec:after` via `hooksFire('spec', 'before'|'after', name, index, total, ctx)`
from `lib/kbd/hooks.mjs` (`spec` is a recognized `kind`).

```js
import { hooksFire } from '../../lib/kbd/hooks.mjs';

await hooksFire('spec', 'before', phase, 1, 1, { orchestratorRoot, cwd, runCommand });
// … write change specs …
await hooksFire('spec', 'after', phase, 1, 1, { orchestratorRoot, cwd, runCommand });
```

## Stage gate & handoff

```js
import { stageGate, stageHandoffWrite } from '../../lib/kbd/stage-gate.mjs';

const gate = stageGate('spec', { cwd });
if (gate.status !== 0) throw new Error(gate.stderr);

// … write change specs, adversarial vet …

stageHandoffWrite('spec', '<changes created>', [firstChangeSpecPath], { cwd });
```

## Examples

```
/kbd-spec                                # uses active waypoint phase
/kbd-spec canonical-lifecycle            # explicit phase name
```
