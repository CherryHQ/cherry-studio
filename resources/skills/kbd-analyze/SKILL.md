---
name: kbd-analyze
description: Use to run the Analyze stage of the KBD lifecycle (between Assess and Spec) — research the engineering landscape (existing open-source libraries, frameworks, skeletons that fit the assessed gaps, plus stack discovery when none is specified) and write the candidate set that the Spec and Plan stages consume.
---

# /kbd-analyze

Run the **Analyze** phase of the KBD lifecycle — between Assess and Spec.

## What this does

Turns the assessment's gaps and unknowns into researched, evidence-backed
build-vs-adopt decisions before any spec is written. This is the engineering
counterpart to an outer evolution loop's business-landscape Analyze: KBD
Analyze researches libraries/frameworks/skeletons and writes its findings into
`.kbd-orchestrator/`.

Outputs to `.kbd-orchestrator/phases/<phase>/`:

- `analysis.md` — narrative: landscape, candidate evaluation, build-vs-adopt
  calls, open questions.
- `library-candidates.json` — machine contract for Spec/Plan.
- `stack-recommendation.md` — only in stack-discovery mode.
- appends to `decision-log.md`.

## The research pipeline

1. **Tier 1** `gh search repos/code` → existing frameworks, skeletons.
2. **Tier 2** Context7 / docfork → confirm API fit + version constraints.
3. **Tier 3** registries (`npm view` / `cargo search` / PyPI) → maintenance health.
4. **Tier 4** firecrawl/tavily → stack comparisons, only when 1–3 insufficient.

Hard budget: 8 queries per tier, 20 minutes total. On a cap, stop and report
partial findings with lowered confidence — never loop to chase completeness.

### Modes

- **Stack specified** — rank candidates within the named stack per gap.
- **Stack discovery** — produce 2–3 scored stack options in
  `stack-recommendation.md`, then research candidates against the pick. A
  contested choice (score gap < 15%) is flagged for the user in `analysis.md`
  and the decision log — never silently pick a contested stack; ask the
  operator directly (e.g. with `AskUserQuestion` on Claude Code) rather than
  through a separate elicitation subsystem this project does not carry.

Record in `decision-log.md` on resolution:
```
### <timestamp> — Contested stack choice
Options: <A> vs <B> | Score gap: <N>%
Decision: <chosen> | Provenance: <user|research|implicit>
```

## Skipping

For phases that need no external research:

```
/kbd-analyze --skip "<reason>"
```

writes a skip handoff so the Spec gate passes deliberately rather than by drift
— see "Stage gate & handoff" below.

## Progress Signals (MANDATORY)

**FIRST tool call of every turn:** Read `.kbd-orchestrator/position-reminder.txt` (if it exists) to get the current phase, step N of T, and next command. If that file is absent, read `.kbd-orchestrator/current-waypoint.json`.

Before any other action, emit to plain response text (BEFORE any tool call):

```
Starting kbd-analyze — <phase-name> (step N of T)
```

When the candidate set is written (or the stage is skipped), emit:

```
Completed kbd-analyze — <phase-name> (step N of T)
```

**How to get N and T (MANDATORY — never estimate):** read
`completion.implementation.completed`/`.total` from `progress.json` via
`implementationCompleted(progress)`/`implementationTotal(progress)`
(`lib/kbd/progress.mjs`), falling back to `current-waypoint.json`'s
`implementationCompleted`/`implementationTotal` when `progress.json` is
absent.

Use the canonical phase name from the argument or `current-waypoint.json`. Emit to plain response text — no tool call needed.

## How to invoke

1. **Confirm the active phase** — argument or `current-waypoint.json`.
2. **Stage gate** — `stageGate('analyze', { cwd })` from `lib/kbd/stage-gate.mjs`
   (requires the assess handoff).
3. **Read inputs** — `assessment.md`; `prior-context.md` (memory recall) and an
   ideation mindmap id when greenfield.
4. **Run the tiered pipeline** above.
5. **Write artifacts** — `analysis.md`, `library-candidates.json`,
   `stack-recommendation.md` (discovery mode), `decision-log.md`.
6. **Adversarial vet** — when `adversarial-review` is installed and
   `--skip-adversarial-review` was not passed, run it in artifact mode against
   `analysis.md` + `library-candidates.json`. CRITICAL findings → revise and
   re-vet (max 2 rounds, then accept with an "Unresolved review findings"
   section appended). WARNING findings → carry into the handoff.
7. **Write handoff** — see "Stage gate & handoff" below.

## Hook integration

Fires `analyze:before` / `analyze:after` via `hooksFire('analyze', 'before'|'after', name, index, total, ctx)`
from `lib/kbd/hooks.mjs` (`analyze` is a recognized `kind` in its event
normalization). See the parent `kbd-process-orchestrator` skill's "Hooks"
section for the full taxonomy.

```js
import { hooksFire } from '../../lib/kbd/hooks.mjs';

await hooksFire('analyze', 'before', phase, 1, 1, { orchestratorRoot, cwd, runCommand });
// … run pipeline, write artifacts, run adversarial vet …
await hooksFire('analyze', 'after', phase, 1, 1, { orchestratorRoot, cwd, runCommand });
```

## Stage gate & handoff

```js
import { stageGate, stageHandoffWrite, stageHandoffSkip } from '../../lib/kbd/stage-gate.mjs';

const gate = stageGate('analyze', { cwd });
if (gate.status !== 0) throw new Error(gate.stderr);

// … pipeline, artifacts, adversarial vet …

stageHandoffWrite(
  'analyze',
  '<candidate count, key adopt verdicts, open questions; include any WARNING findings from adversarial review>',
  ['analysis.md', 'library-candidates.json'],
  { cwd },
);
```

For `--skip "<reason>"`, call `stageHandoffSkip('analyze', reason, { cwd })`
instead of `stageHandoffWrite` — `analyze` is one of `stageGate`'s two OPTIONAL
stages, so a later stage's gate walks back past a missing/skipped analyze
handoff instead of failing.

## Examples

```
/kbd-analyze                             # uses active waypoint phase
/kbd-analyze canonical-lifecycle         # explicit phase
/kbd-analyze --skip "no external deps needed this phase"
```
