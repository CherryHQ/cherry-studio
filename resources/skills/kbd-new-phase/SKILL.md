---
name: kbd-new-phase
description: Manually create a new top-level KBD phase. Accepts <name> [goals…] and initialises the phase directory, waypoint, project.json activePhase, and fires phase:before. Use this when no prior reflection exists (e.g. very first phase of a new project), when pivoting away from /kbd-next-phase's suggestion, or when initialising state by hand.
---

# /kbd-new-phase

Create a fresh top-level KBD phase from scratch — the manual-entry
counterpart to `/kbd-next-phase`.

## What this does

1. Parses arguments — `<name>` plus zero or more `[goals…]`.
2. Validates the name (kebab-case, no path traversal, no slashes).
3. Refuses if `.kbd-orchestrator/phases/<name>/` already exists.
4. In runtime-authority mode, reads canonical status. If the lifecycle is
   `completed`, `cancelled`, or `failed`, starts exactly one operator-signed
   successor run before creating the requested phase.
5. Creates the phase directory and writes `goals.md` + `progress.json`
   atomically.
6. Flips `current-waypoint.json`: `previousPhase ← prior phase`,
   `phase ← <name>`, `status ← assessment_ready`, …; preserves unknown
   fields untouched.
7. Updates `.kbd-orchestrator/project.json` `activePhase` (warns if absent).
8. Fires `phase:before` exactly once for the new phase (best-effort — phase
   persists even if the hooks subsystem is unavailable).
9. Emits the canonical Progress Signals and a confirmation banner.

## When to use

Run when **any** of:

- You're starting the very first phase of a project (no prior reflection
  exists).
- You're pivoting away from the suggestion in the previous phase's
  `reflection.md` (`/kbd-next-phase` is the auto-seed path).
- You're initialising state by hand and want one canonical entry point
  instead of editing `current-waypoint.json` directly.

Compare to `/kbd-next-phase`, which reads `reflection.md → "Recommended
Next Phase"` and auto-seeds the new phase from it.

## Progress Signals (MANDATORY)

```
Starting kbd-new-phase — <name>
Completed kbd-new-phase — <name> ready for /kbd-assess
```

## Prerequisites

- The proposed phase name must not already exist as a directory under
  `.kbd-orchestrator/phases/`.
- `current-waypoint.json`, if present, must be valid JSON. (If it is
  malformed, fix it by hand before retrying; the skill refuses to write
  on top of a corrupted waypoint to avoid compounding the corruption.)

## How to invoke

```bash
boss-mini kbd-new-phase.mjs <name> [goal-1] [goal-2] …
```

## Examples

```
/kbd-new-phase phase-1-foundation
/kbd-new-phase ux-refresh "polish dashboard" "ship dark mode" "audit a11y"
/kbd-new-phase ssed-followup-fixes
```

## Hook integration

`/kbd-new-phase` is a phase-bracket opening writer. It MUST fire
`phase:before` exactly once for the new phase, after the waypoint and
`project.json` flips, and before the `Completed kbd-new-phase` Progress
Signal — so any hook reading state sees the new phase as authoritative.

The closing `phase:after` is the responsibility of `/kbd-reflect` for
the *previous* phase, which should have run already.
