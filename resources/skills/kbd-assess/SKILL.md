---
name: kbd-assess
description: "Use when starting or resuming the KBD lifecycle for a project — inspects the current codebase against the active phase's goals and produces a structured gap report at .kbd-orchestrator/phases/<phase>/assessment.md. Project-agnostic: reads AGENTS.md, spec files, and the codebase itself. Also reads progress.json to account for cross-tool work done since the last session."
---

# /kbd-assess

Run the **Assess** phase of the KBD lifecycle for any project.

## What this does

Inspects the current codebase and produces a structured gap report against the
active phase's goals. Output written to
`.kbd-orchestrator/phases/<phase-name>/assessment.md`.

Also reads `progress.json` to incorporate any work completed by other tools
(Roo, Cursor, Cline, Codex, etc.) since the last session.

## Progress Signals (MANDATORY)

**FIRST tool call of every turn:** Read `.kbd-orchestrator/position-reminder.txt` (if it exists) to get the current phase, step N of T, and next command. If that file is absent, read `.kbd-orchestrator/current-waypoint.json`.

Before any other action, emit to plain response text (BEFORE any tool call):

```
Starting kbd-assess — <phase-name> (step N of T)
```

When all steps are complete, emit:

```
Completed kbd-assess — <phase-name> (step N of T)
```

**How to get N and T (MANDATORY — never estimate):**
- Read `.kbd-orchestrator/phases/<phase>/progress.json` →
  `completion.implementation.completed` = N and `.total` = T; fall back to
  legacy `changes_completed` / `changes_total` only when canonical fields are absent.
  `implementationCompleted(progress)` / `implementationTotal(progress)` from
  `lib/kbd/progress.mjs` are the single source of truth for this — they already
  encode the legacy-alias fallback, so read counters through them rather than
  re-deriving the precedence by hand.
- If `progress.json` is absent, read `current-waypoint.json` →
  `implementationCompleted` / `implementationTotal`, then legacy aliases.

Use the canonical phase name from the argument or `current-waypoint.json`. Emit to plain response text — no tool call needed.

## How to invoke

0. **Model preflight** — assess is the KBD entry stage. When `adversarial-review`
   is installed in this project, run its preflight step up front (cached 24h)
   before continuing. Never block the stage on preflight status — degrade and
   continue.
1. **Discover project identity** — read `.kbd-orchestrator/project.json` or infer
   from `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, `Cargo.toml`, etc.
2. **Confirm the active phase** — from argument or `.kbd-orchestrator/current-waypoint.json`
3. **Resume from progress** — read `.kbd-orchestrator/phases/<phase>/progress.json`
   to account for cross-tool work done
4. **Load specs** — read `openspec/specs/*.md` if OpenSpec is available,
   otherwise read the canonical spec files defined in `.kbd-orchestrator/project.json`
5. **Inspect the codebase** — scan feature directories, components, routes, etc.
6. **Write assessment file** to `.kbd-orchestrator/phases/<phase>/assessment.md` —
   gaps against phase goals, open questions, confidence per finding
7. **Adversarial vet** — when `adversarial-review` is installed and
   `--skip-adversarial-review` was not passed, run it in artifact mode against
   the written assessment. CRITICAL findings → revise `assessment.md` and re-vet
   (max 2 rounds, then accept with an "Unresolved review findings" section
   appended). WARNING findings → carry into the stage handoff summary.
8. **Enter/complete the assessment stage** by recording the stage handoff (see
   below); never hand-edit `progress.json` directly.

## Examples

```
/kbd-assess                              # uses active waypoint phase
/kbd-assess phase-1-foundation           # explicit phase name
/kbd-assess phase-2-sales-module         # for a new project phase
```

## Hook integration

Fire `assess:before` immediately after the "Starting kbd-assess —" Progress
Signal, and `assess:after` immediately before the "Completed kbd-assess —"
Progress Signal. The existing Progress Signals continue to fire — hooks are
complementary, not a replacement.

The dispatcher is `hooksFire(kind, edge, name, index, total, ctx)` from
`lib/kbd/hooks.mjs`. It requires `ctx.orchestratorRoot` and `ctx.runCommand` —
an injected `async (command, env, { timeout }) => { status, stdout, stderr }`
that actually executes a matched hook's configured command (this repo never
shells out to a command string; see `lib/platform/spawn.mjs`). A caller
running this skill programmatically would do the equivalent of:

```js
import { hooksFire } from '../../lib/kbd/hooks.mjs';

await hooksFire('assess', 'before', phase, 1, 1, { orchestratorRoot, cwd, runCommand });
// … write assessment.md …
await hooksFire('assess', 'after', phase, 1, 1, { orchestratorRoot, cwd, runCommand });
```

See the parent `kbd-process-orchestrator` skill's "Hooks" section for the full
event taxonomy, override semantics, and `KBD_HOOK_*` payload — all of which
`hooksFire` implements as documented there.

## Stage gate & handoff

Assess is the first stage, so its gate always passes — call it anyway for
uniformity. After writing `assessment.md`, record the handoff that the next
stage (analyze, or plan when analyze is skipped) reads first.

`lib/kbd/stage-gate.mjs` exports `stageGate(stage, ctx)`,
`stageHandoffWrite(stage, summary, outputs, ctx)`, and
`stageHandoffSkip(stage, reason, ctx)`:

```js
import { stageGate, stageHandoffWrite } from '../../lib/kbd/stage-gate.mjs';

const gate = stageGate('assess', { cwd });
if (gate.status !== 0) throw new Error(gate.stderr); // remediation text is in gate.stderr

// … write assessment.md …

stageHandoffWrite(
  'assess',
  '<1–3 sentences: key gaps found, open questions for analyze/plan; include any WARNING findings from adversarial review>',
  ['assessment.md'],
  { cwd },
);
```

Phases without a `handoffs/` directory are legacy: `stageGate` warns (via its
returned `stderr`) and still passes. A deliberate stage skip is recorded with
`stageHandoffSkip('assess', '<reason>', { cwd })`.
