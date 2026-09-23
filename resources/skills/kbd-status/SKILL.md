---
name: kbd-status
description: Use to show current KBD process status — active phase, change inventory, goal completion, and next recommended action. Reads progress.json to surface work completed by all tools (Antigravity, Roo, Cursor, Cline, Codex, etc.).
---

# /kbd-status

Show current KBD process state for the active project.

## What this does

Reads orchestrator state and progress ledger, then produces a complete status
summary including cross-tool work visibility.

Output includes:

- Project name and active phase
- OpenSpec changes: active / in-progress / archived (if OpenSpec available)
- Native KBD changes: status from `progress.json`
- Goal completion: MET | PARTIAL | NOT MET per goal
- Last tool to update state and when
- Waypoint-guided next recommended action
- Separate implementation, evidence, certification, and publication state

## Completion semantics (mandatory)

Render `completion.implementation.completed/total` as the KBD `N/N` counter,
via `implementationCompleted(progress)`/`implementationTotal(progress)` from
`lib/kbd/progress.mjs`. Fall back to legacy `changes_completed/changes_total`
only when the canonical object is absent — those functions already encode
that fallback. Never derive implementation completion from `tasks_done`,
unchecked OpenSpec boxes, evidence availability, elapsed time, authorization,
certification, or publication.

`dimensionStatus(progress, dimension)` (also from `lib/kbd/progress.mjs`)
renders each of `evidence`, `certification`, `publication` on separate lines.
A phase can therefore be `24/24 implementation complete` while certification
or publication is still pending. In that state, do not describe any
implemented change as a code gap and do not recommend implementation work
unless a concrete source defect is identified.

## Progress Signals (MANDATORY)

When the status output is ready to display, emit:

```
Completed kbd-status — <phase-name>
```

The status output itself serves as the start signal. Emit the completion signal after printing the full status table. Use the canonical phase name from `current-waypoint.json`. Emit to plain response text — no tool call needed.

## How to invoke

1. **Discover project identity** — read `.kbd-orchestrator/project.json` or infer
2. **Read waypoint** — `.kbd-orchestrator/current-waypoint.json`
3. **Read progress** — `.kbd-orchestrator/phases/<phase>/progress.json`
4. **Resolve worktree root** — see *Worktree awareness* below
5. **Render phase chain** — see *Phase chain rendering* below
6. **Read phase artifacts** — `assessment.md`, `plan.md`, `execution.md`
7. **If OpenSpec**: read `openspec/changes/` active + `openspec/changes/archive/`
8. **Print status table**

## Phase chain rendering

The active phase is rendered as a chain reflecting the nested-phase fields
described in the parent `kbd-process-orchestrator` skill's "Nested phases"
section:

- `parentPhase = null` and `childPhases = []` → `phase: <name>`.
- `parentPhase = null` and `childPointer = <c>` selecting a member of `childPhases` → `phase: <parent> › <c>` and a follow-up line `children: <i>/<n>` (1-based index of the pointer + total count).
- `parentPhase = <p>` (this row is itself a child) → `phase: <p> › <name>`. If the row *also* has a `childPointer`, append `› <pointer>` for grand-child chains.
- `childPhases` non-empty but `childPointer = null` → `phase: <name>  (children defined, none active)`.

The separator character is U+203A `›` by default. `chainSeparator(env)` from
`lib/kbd/waypoint.mjs` falls back to ` > ` (space-greater-space) when `LC_ALL`
or `LANG` is `POSIX` / `C` / `C.*`.

The chain is sourced from `lib/kbd/waypoint.mjs`: call `waypointLoad(filePath)`
to parse the waypoint with documented defaults, then `waypointChain(parent, phase, pointer, env)`
to render.

## Worktree awareness

After rendering the phase line, the skill renders one mandatory `worktree:`
line, immediately before the `change:` line. Resolution order:

1. Resolve `worktreeRoot` from `project.json` (`worktreeRoot` field). If
   absent or unreadable, fall back to the literal string `${HOME}/.claude/worktrees`.
2. Expand `${HOME}` (and `${USER}` for parity) in the resolved value using the
   current environment — `expandKbdPath(input, env)` from `lib/kbd/waypoint.mjs`
   does this safely (no `eval`).
3. Compute the git repository root from the current working directory.

Then emit:

- Inside the root: `worktree: <path>` (no annotation).
- Outside the root, or exactly at the root itself: `worktree: <path>  ⚠ outside worktreeRoot (<resolved-root>)`.
- Not inside a git checkout: `worktree: (none — not inside a git checkout)`.
- `git` not available: `worktree: (none — git not available)`.
- `project.json` unreadable (permissions, corrupt JSON): `worktree: <path>  ⚠ project.json unreadable, using default root`.

The skill never blocks on any of these conditions — the rest of the status
report MUST always render.

## Render order (append-only stability)

To preserve grep-based scripts and human muscle memory, lines emitted in
`Output Example` retain their existing positions:

1. `phase: …` *(always)*
2. `children: i/n` *(only when childPhases populated and childPointer set, or `(children defined, none active)` when set without pointer)*
3. `worktree: …` *(always rendered)*
4. `Last updated by: …` *(and every line below)*

## Output Example

```
KBD STATUS — <Project Name>
phase: phase-2-sales-module
worktree: /Users/jane/.claude/worktrees/phase-2-sales-module
Last updated by: roo-code (2026-03-12T04:30:00Z)

Implementation: 4/4 COMPLETE
Evidence:       IN_PROGRESS
Certification: PENDING
Publication:   NOT_TRACKED

Goals:
  [✅] Sidebar user profile wired to real data
  [🔄] Team invitations email flow (IN_PROGRESS — started by antigravity)
  [⬜] Clients page full implementation
  [⬜] Deals 4-step wizard

Changes:
  DONE:        change-006-sidebar-user-profile (completed by: antigravity)
  IN_PROGRESS: change-007-complete-team-invitations (4/8 tasks, started by: antigravity)
  PENDING:     change-008-clients-page
  PENDING:     change-009-deals-page

Next action (from waypoint): apply change-007-complete-team-invitations
```

### Example — nested phase, outside worktreeRoot

```
KBD STATUS — <Project Name>
phase: submodule-skills-and-entity-devtools-expansion › ssed-kbd-process-hooks
children: 3/11
worktree: /Users/jane/projects/foo  ⚠ outside worktreeRoot (/Users/jane/.claude/worktrees)
Last updated by: claude-code (2026-05-27T00:00:00Z)
...
```

## Examples

```
/kbd-status                   # current project + active phase
/kbd-status phase-1-foundation # status of a specific phase
```
