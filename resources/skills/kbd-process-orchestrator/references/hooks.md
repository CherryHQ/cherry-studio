# KBD Hooks

> Extracted from the orchestrator SKILL.md. The hook surface fired around every KBD lifecycle boundary — event taxonomy, discovery order, per-fire context, wiring, and debugging.

KBD ships an extensible hook surface fired around every lifecycle boundary.
Each KBD skill emits a hook event before its work and another after, and any
project can plug in either *augment* (adds behavior) or *override* (replaces
the default) entries.

**Canonical event form**: `<kind>:<edge>`, where

- `kind` ∈ `phase` | `child` | `change` | `plan` | `execute` | `reflect` | `task` | `assess` | `spec` | `analyze` | `*`
- `edge` ∈ `before` | `after` | `*`

**Legacy alias compatibility** (kept working — no migration required):

| Legacy event | Canonical event |
|---|---|
| `on_phase_complete` | `phase:after` |
| `on_plan_complete` | `plan:after` |
| `on_reflection_complete` | `reflect:after` |
| `on_assessment_complete` | `assess:after` |
| `on_change_complete` | last `task:after` of the change (sentinel — fires when `index == total`) |
| `<kind>:begin` | `<kind>:before` |
| `<kind>:end` | `<kind>:after` |
| `on_blocker_detected`, `on_cross_tool_handoff` | unchanged — situational, not lifecycle |

This normalization is implemented by `normalizeEvent(event)` in `lib/kbd/hooks.mjs`.

**Discovery order** (highest precedence wins on override conflicts):

1. **builtin** — `<orchestratorRoot>/hooks/hooks.json`
2. **user** — `<orchestratorRoot>/hooks/user.json` (optional)
3. **project** — `.kbd-orchestrator/hooks-config.json` (optional)

`orchestratorRoot` is `ctx.orchestratorRoot`, a required field callers pass to
`hooksFire`; there is no environment-variable fallback in this port.

**Mode field** — each entry declares `mode: augment` (default) or `mode: override`. Multiple overrides on the same `(kind, edge)` resolve to the entry from the highest layer; within a layer, last-loaded wins. `resolveOverrides` (internal to `lib/kbd/hooks.mjs`) implements this precedence; dispatch never aborts on a conflict.

**Default reporter** — the built-in `report-progress` hook fires on every `*:*`. This port has no implicit stderr channel from a library function — a hook's outcome is visible in the JSONL log and `hooks-status.json` this call writes (see below), and the caller decides how/whether to surface it further. A project can replace the reporter wholesale with a single `mode: "override"` entry covering `"*:*"`.

> **Guarantee vs. extension (read this).** A hook firing is **not** what the
> user sees each turn. The user-facing guarantee is the **plain-text Progress
> Signals** that every skill emits. The hooks dispatcher is the *extension
> point* (telemetry, memory mirror, custom reporters).

**Per-fire context** — every hook command receives these environment variables (in addition to `${PHASE}`, `${STEP}`, `${EVENT}` substitutions), exactly as `runEntry` in `lib/kbd/hooks.mjs` builds them:

| Variable | Meaning |
|---|---|
| `KBD_HOOK_KIND` | phase / child / change / plan / execute / reflect / task / assess / spec / analyze |
| `KBD_HOOK_EDGE` | before / after |
| `KBD_HOOK_NAME` | active item's canonical name |
| `KBD_HOOK_INDEX` | 1-based index in the containing loop (default 1) |
| `KBD_HOOK_TOTAL` | total count in the containing loop (default 1) |
| `KBD_HOOK_PHASE_PATH` | rendered chain (`ctx.phasePath`) |
| `KBD_HOOK_CHILD_PATH` | active child name, or empty (`ctx.childPath`) |
| `KBD_HOOK_SOURCE_TOOL` | `ctx.sourceTool`, or `"unknown"` |
| `KBD_HOOK_STARTED_AT` | ISO-8601 UTC timestamp |

**Hook log** — every fire appends one JSON object to `.kbd-orchestrator/phases/<phase>/hooks.log.jsonl` (or `.kbd-orchestrator/hooks.log.jsonl` when no phase is active yet). Schema:

```json
{"ts":"…","kind":"task","edge":"after","name":"1.1 …","index":1,"total":7,
 "phasePath":"parent › child","sourceTool":"claude-code",
 "hookId":"project/on-task-done","layer":"project","mode":"augment","status":0}
```

Failure entries include `"stderrSnippet"` truncated to 200 chars. A rolling
`hooks-status.json` alongside it (same directory) tracks `totalRuns`,
`failedRuns`, `lastRun`, and `lastFailure`.

### Calling the dispatcher

There is no shell "source" step in this port — `hooksFire` is an ordinary
`lib/kbd/` export:

```js
import { hooksFire } from '../../lib/kbd/hooks.mjs';

await hooksFire(kind, 'before', itemName, index, total, {
  orchestratorRoot, cwd, runCommand, phasePath, childPath, sourceTool,
});
// … do the work …
await hooksFire(kind, 'after', itemName, index, total, {
  orchestratorRoot, cwd, runCommand, phasePath, childPath, sourceTool,
});
```

`ctx.runCommand` is required and is an injected
`async (command, env, { timeout }) => { status, stdout, stderr }` that
actually executes a matched hook's configured command. This repo forbids
shell-string execution (see `.claude/rules/node-scripts.md`), so a hook
`command` that relies on shell features (`&&`, pipes, globbing) needs its
config rewritten to something `runCommand` can execute directly — e.g. a
program + argv array via `lib/platform/spawn.mjs`'s `spawnExecutable`.

The existing `Starting/Completed kbd-<skill> — <phase>` Progress Signals
(documented in each skill's "Progress Signals (MANDATORY)" section)
**continue to fire** alongside hook events; the two are complementary.
Progress Signals are agent-facing structured lines; hook output is
operator-facing observability.

### Debugging

Set `KBD_HOOK_DEBUG=1` in the environment as a convention for a future
debug-logging wrapper. `lib/kbd/hooks.mjs` does not itself read this variable
today — a caller that wants per-fire normalization tracing should log
`normalizeEvent`'s input/output around its own `hooksFire` calls until such a
wrapper exists.
