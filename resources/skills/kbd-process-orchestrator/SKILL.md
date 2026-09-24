---
name: kbd-process-orchestrator
description: Use to coordinate the full KBD (Knowledge-Based Development) lifecycle for any project — Assess, Analyze, Plan, Execute, Reflect — at every granularity level (global phases, spec-backed changes, and artifact-level QA). This is the coordination and reference document for the kbd-* sub-skills; it documents the progress.json schema, the waypoint contract, the hook taxonomy, and the sub-skill list. It has no executable logic of its own — read it once, then invoke the specific kbd-<stage> skill for the work itself.
---

# KBD Process Orchestrator

The universal process orchestrator for any software project. Implements a
Knowledge-Based Development lifecycle using staged orchestration at three
nested levels: phase, change, and artifact.

This skill is **project-agnostic**. It derives project identity from context
(`AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, `Cargo.toml`, or
explicit prompt arguments). Do not hard-code project names into this skill.

---

## Progress Signals (MANDATORY)

Every KBD skill emits signals at the start and end of its work. This
orchestrator coordinates but does not double-emit — individual skills own
their own signals.

**Cross-phase signal rule**: When orchestrating a full phase cycle (Assess → Plan → Execute → Reflect), emit phase-level signals at the orchestrator level:

```
Starting phase <N> of <total>: <phase-name>
```

When the phase cycle is complete:

```
Completed phase <N> of <total>: <phase-name>
```

Read change totals from the active phase’s `completion.implementation` and phase totals from the canonical phase list — never use change totals as phase totals or guess. Emit to plain response text — no tool call needed. Individual skills (`kbd-assess`, `kbd-plan`, etc.) emit their own skill-level signals independently.

---

## Project Context Discovery

On every invocation, before acting, KBD MUST:

1. **Identify the project name** — read, in priority order:
   - Explicit argument (`/kbd-plan my-project`)
   - `.kbd-orchestrator/project.json` if it exists
   - `AGENTS.md` header or `CLAUDE.md` header
   - `README.md` first heading
   - `package.json` → `name`, `Cargo.toml` → `[package] name`, `pyproject.toml` → `name`

2. **Identify project-specific constraints** — read `AGENTS.md` and the
   project's canonical spec files (OpenSpec `openspec/specs/*.md`, or
   equivalent spec directory defined in `.kbd-orchestrator/project.json`).

3. **Derive the technology stack** — identify from lock files / config files
   to tailor the Build Health and Test Coverage assessment dimensions.

---

## The Three Levels

### Level 1 — Global Phase (this skill)

Assess → Analyze → Spec → Plan → Execute (dispatch through completion) → Reflect.
KBD owns canonical phase state. This repository uses OpenSpec for changes,
with designated AI tools performing tasks through `kbd-apply`.

### Level 2 — Change (inner loop)

A change is created during **spec/plan**, then driven task-by-task in
**execute** by the shipped `kbd-apply` skill and `scripts/kbd-apply.mjs`.
Use `begin-task` / `end-task` for every task, then driver `verify` → `archive`
after QA and independent review. Never invoke bare OpenSpec apply inside KBD.
The parent Execute stage remains active through all assigned changes/tasks and
their required gates. `execution.md` and `execute-dispatch.json` record dispatch;
only the completed boundary gets `execute:after` and
`handoffs/execute.handoff.json`. See `skills/kbd-execute/SKILL.md` for its
completion checklist.

### Level 3 — Artifact QA (innermost)

`artifact-refiner` Specify → Plan → Execute → Reflect → Persist, when that
skill is installed in this project.

---

## Multi-Tool Coordination Architecture

The canonical runtime journal under `.kbd-orchestrator/runtime/` is the
coordination authority. Harnesses use typed `prometheus kbd` commands through
the shipped Node adapters and read the generated views below. Shared modules
also retain legacy migration support; that is not permission to hand-edit
progress, position, or waypoint files.

### State files

| File                                             | Written by         | Read by     | Purpose                           |
| ------------------------------------------------ | ------------------ | ----------- | --------------------------------- |
| `.kbd-orchestrator/current-waypoint.json`        | projection writer  | All tools   | Derived resume view (`lib/kbd/waypoint.mjs`) |
| `.kbd-orchestrator/current-waypoint.md`          | projection writer   | All tools   | Human-readable waypoint summary   |
| `.kbd-orchestrator/phases/<phase>/assessment.md` | kbd-assess         | kbd-analyze/kbd-plan | Gap analysis output      |
| `.kbd-orchestrator/phases/<phase>/analysis.md`   | kbd-analyze        | kbd-spec/kbd-plan | Engineering-landscape research |
| `.kbd-orchestrator/phases/<phase>/library-candidates.json` | kbd-analyze | kbd-spec/kbd-plan | Build-vs-adopt candidate set |
| `.kbd-orchestrator/phases/<phase>/handoffs/*.handoff.json` | each stage | next stage gate | Stage precondition + summary (`lib/kbd/stage-gate.mjs`) |
| `.kbd-orchestrator/position.json`                | projection writer  | kbd-status/renderer | Revision-bound derived position tree |
| `.kbd-orchestrator/phases/<phase>/plan.md`       | kbd-plan           | kbd-execute | Ordered change list               |
| `.kbd-orchestrator/phases/<phase>/execution.md`  | kbd-execute        | All tools   | Backend dispatch contract         |
| `.kbd-orchestrator/phases/<phase>/execute-dispatch.json` | kbd-execute | All tools | Dispatch receipt; never a completed-stage handoff |
| `.kbd-orchestrator/phases/<phase>/progress.json` | projection writer  | kbd-status  | Derived implementation/evidence/certification/publication ledger (`lib/kbd/progress.mjs`) |
| `.kbd-orchestrator/phases/<phase>/reflection.md` | kbd-reflect        | Next phase  | Phase retrospective               |
| `.kbd-orchestrator/project.json`                 | kbd-init; phase helpers for activePhase/bootstrap | All tools   | Project identity + config         |
| `.kbd-orchestrator/phases/<phase>/hooks.log.jsonl` | hooks dispatcher  | operators   | Append-only hook fire log (`lib/kbd/hooks.mjs`) |
| `.kbd-orchestrator/phases/<phase>/hooks-status.json` | hooks dispatcher | operators | Rolling hook success/failure summary |

### progress.json Protocol

`progress.json` is a derived projection: when `generatedBy` is
`kbd-runtime`, this project's own canonical runtime (if it has one) owns
writes to it, and `markImplementationComplete` in `lib/kbd/progress.mjs`
delegates rather than writes directly in that mode. Otherwise it is a legacy
ledger that `lib/kbd/progress.mjs` reads, transforms, validates
(`validateProgress`), and atomically rewrites in place — see that module for
the exact branch logic.

The following is a compatibility ledger example, not an initialization
template or the full canonical runtime schema:

```json
{
  "schemaVersion": "2",
  "phase": "<phase-name>",
  "last_updated": "<ISO 8601 timestamp>",
  "last_updated_by": "<tool-name: antigravity|roo|cursor|codex|cline|opencode|windsurf|human>",
  "implementation_total": 0,
  "implementation_completed": 0,
  "changes_total": 0,
  "changes_completed": 0,
  "completion": {
    "primaryCounter": "implementation",
    "implementation": { "completed": 0, "total": 0, "status": "PENDING" },
    "evidence": { "status": "NOT_TRACKED", "summary": null, "blockers": [] },
    "certification": { "status": "NOT_TRACKED", "summary": null, "blockers": [] },
    "publication": { "status": "NOT_TRACKED", "summary": null, "blockers": [] }
  },
  "changes": [
    {
      "id": "<change-id>",
      "status": "PENDING|IN_PROGRESS|DONE|BLOCKED|SKIPPED",
      "implementation_status": "PENDING|IN_PROGRESS|COMPLETE|BLOCKED|SKIPPED",
      "evidence_status": "NOT_TRACKED|NOT_REQUIRED|PENDING|IN_PROGRESS|COMPLETE|BLOCKED",
      "certification_status": "NOT_TRACKED|NOT_REQUIRED|PENDING|IN_PROGRESS|COMPLETE|BLOCKED",
      "publication_status": "NOT_TRACKED|NOT_REQUIRED|PENDING|IN_PROGRESS|COMPLETE|BLOCKED",
      "tasks_total": 0,
      "tasks_done": 0,
      "last_task_completed": "<task description or null>",
      "next_task_pending": "<task description or null>",
      "started_by": "<tool-name>",
      "completed_by": "<tool-name or null>",
      "blockers": []
    }
  ]
}
```

The ledger's canonical counter is `completion.implementation`, read via
`implementationCompleted(progress)` / `implementationTotal(progress)` in
`lib/kbd/progress.mjs`. Legacy `changes_completed` and `changes_total` remain
compatibility aliases of that counter only. They MUST NOT count evidence,
certification, authorization, elapsed-time, external-adopter, or publication
gates.

**Completion invariant:** once a change's code and integration contract is
implemented, call `markImplementationComplete(progressFile, changeId, ctx)`
(`lib/kbd/progress.mjs`); the projection then shows
`implementation_status: COMPLETE` even when evidence or publication remains
pending. Unchecked OpenSpec tasks marked `EVIDENCE`, `TIME_BOUND`,
`AUTHORIZATION`, or `EXTERNAL` never reopen implementation. Never edit
counters in the projection by hand.

---

## Execution Model

### Startup — always do this first

1. **Discover project identity** — follow Project Context Discovery above
2. **Load waypoint** — read `.kbd-orchestrator/current-waypoint.json` via
   `waypointLoad(filePath)` from `lib/kbd/waypoint.mjs` as the preferred
   resume contract before inferring the next action
3. **Load phase context** — identify active phase, load existing phase artifacts
4. **Load domain knowledge** — read `AGENTS.md`, spec files
5. **Check runtime status** — if this project has its own canonical runtime
   CLI, use its status command; otherwise use `progress.json` as the
   human-readable projection directly

### Loop

1. **Assess** (`skills/kbd-assess/SKILL.md`) — inspect repo, reconcile with spec, surface gaps
2. **Analyze** (`skills/kbd-analyze/SKILL.md`) — identify highest-leverage missing features, prioritize
3. **Spec** (`skills/kbd-spec/SKILL.md`) — turn gaps into concrete, ordered changes
4. **Plan** (`skills/kbd-plan/SKILL.md`) — produce ordered list of changes for this phase
5. **Execute** (`skills/kbd-execute/SKILL.md`) — dispatch and remain active through all assigned tasks, QA/review, verification, and archive; write the completion handoff only at that boundary
6. **Reflect** (`skills/kbd-reflect/SKILL.md`) — capture lessons, seed next phase
7. **Persist** — record typed KBD transitions; review and commit intended artifacts and runtime projections under project policy

After each phase: checkpoint + dispatch workflow triggers.

---

## Spec backend policy

This repository requires OpenSpec and pins `specBackend: openspec`. Create
changes through the project’s OpenSpec workflow; run their tasks, verification,
and archival through `kbd-apply`. Missing CLI or change artifacts are blockers
to repair, not permission to switch backends or claim completion.

The reusable `lib/kbd/spec-backend.mjs` also implements native-kbd for other
projects and legacy changes. Its detector honors an explicit pin first, then
change-local shape, then repository evidence. It can recognize Spec Kit, but
this mini port has no Spec Kit execution adapter. These library capabilities
do not change the OpenSpec policy for work in this repository.

---

## Wayfinding State

KBD maintains a resumable return point for the current phase.

- Derived resume files:
  - `.kbd-orchestrator/current-waypoint.md`
  - `.kbd-orchestrator/current-waypoint.json`
- Minimum fields (all documented, with defaults, in `waypointLoad` —
  `lib/kbd/waypoint.mjs`):
  - `phase` — current phase name (`activePhase` is accepted only as a legacy
    read alias in the upstream schema; this port's `waypointLoad` reads
    `phase` directly)
  - `backend` — selected execution backend
  - `lastCompletedChange` — last archived/completed change ID
  - `nextPendingChange` — next change to start
  - `sourceTool` — which tool last updated this projection
  - `exactNextCommand` — contextual guidance; confirm against canonical pending work
  - `nextChange` / `nextTask` — the concrete next unit of work

When the waypoint exists, any AI tool should consult it before deriving
status from broader phase discovery.

### Nested phases

The waypoint supports a *parent → child* relationship between phases via
three fields, all read with documented defaults by `waypointLoad`:

- `parentPhase: string | null` — name of the enclosing phase when this row
  represents a child. Default `null` (top-level phase).
- `childPhases: string[]` — ordered list of child-phase names owned by this
  row's phase. Default `[]`.
- `childPointer: string | null` — name of the currently-active child within
  `childPhases`, or `null` when no child is active. Default `null`.

**Cross-field invariants:**

- `childPointer`, when non-null, MUST be a member of `childPhases`.
- `childPhases` MUST NOT contain duplicates.

**Arbitrary-depth nesting (`path[]`).** The waypoint also carries `path:
string[]` — the canonical position chain for *any* nesting depth, synthesized
additively from the parent/child fields when absent. `lib/kbd/waypoint.mjs`
exports the full toolkit for this:

- `kbdNodeDir(...segments)` — the on-disk node dir (repo-relative) for an
  arbitrary-depth `path[]`.
- `kbdNodeChain(segments, env)` — the rendered N-level breadcrumb.
- `kbdExistingPathTokens(waypointPath, root)` — the longest existing prefix of
  the waypoint's `path[]`, trimming stale child pointers instead of
  propagating non-existent nodes into derived state.
- `kbdCurrentNodeDir(waypointPath, root)` — the active node dir resolved from
  the waypoint's `path[]`.
- `isDescendant(child, parent)` — whether `child` is a real descendant of
  `parent` (same path does not count), canonicalizing both sides with
  `fs.realpathSync` so a symlink ambiguity in either path doesn't produce a
  false negative.

`lib/kbd/rollup.mjs`'s `rollupChildren(nodeDir)` / `rollupChain(root, tokens)`
aggregate child-loop progress up the ancestor chain using
`implementationCompleted`/`implementationTotal`/`dimensionStatus` from
`lib/kbd/progress.mjs` and `kbdNodeDir` from `lib/kbd/waypoint.mjs`, rather
than reimplementing the completion-precedence logic a second time.

> **Scope-guard note.** `lib/kbd/check-child-scope.mjs`'s `checkChildScope`
> ships with a default `warn` mode (advisory-only, matching the source's
> posture): it flags writes outside a child loop's `allowedWritePaths` but
> does not block them unless a caller opts into `ask` mode.

**Worktree integration.** `project.json`'s `worktreeRoot` (default
`${HOME}/.claude/worktrees`, expanded via `expandKbdPath` in
`lib/kbd/waypoint.mjs`) is consumed by `/kbd-status` to render the active
checkout and warn when outside the configured root.

---

## Hooks

KBD ships an extensible hook surface fired around every lifecycle boundary:
each skill fires `<kind>:<edge>` events (`kind` ∈ phase/child/change/plan/
execute/reflect/task/assess/spec/analyze, `edge` ∈ before/after), and any
project can plug in *augment* or *override* entries via
`.kbd-orchestrator/hooks-config.json`.

**Full reference — event taxonomy, legacy aliases, discovery order, per-fire
`KBD_HOOK_*` context, the `hooksFire` calling convention, hook log schema, and
debugging — lives in [`references/hooks.md`](references/hooks.md).**

---

## Cross-Tool Reporting Protocol

When an AI tool (Roo, Cursor, Cline, Codex, etc.) is dispatched to execute a
KBD change, it should follow a start/during/completion/blocker protocol —
use `kbd-apply begin-task` / `end-task` at every task boundary and typed KBD
change, completion, and blocker commands. The runtime regenerates progress
and waypoint views; never edit them directly. Review and commit intended
artifacts under project policy.

---

## Blocking Constraints (Project-Derived)

KBD does not hard-code stack-specific constraints. Project constraints are
defined in:

1. `AGENTS.md` — "Never Do" and code style rules
2. `.kbd-orchestrator/constraints.md` — project-specific blocking/warning rules

The executing tool MUST read these files and apply constraints when verifying work.

---

## Required Tools

- File-system read/write — spec files, phase reports, progress ledger
- Multi-step reasoning for phase planning and gap analysis

## Optional Tools

- Web search — external research during the Analyze phase
- A code/build runner — running build/test commands during QA
- The surreal-memory MCP — cross-session persistence, multi-tool coordination, Graph-RAG queries, when reachable

## Surreal-Memory Integration

**Default-on when reachable.** When the configured or canonical local
surreal-memory service passes its health check, KBD mirrors every hook fire
through the entity REST API and can surface `/kbd-memory-recall`-style entity
search; it cleanly no-ops when the service is unreachable.

`lib/kbd/memory.mjs`'s `createMemoryProbe({ root, env, fetchImpl })` builds
the availability probe (memoized per call, resolution order:
`UAR_MEMORY_MCP_URL` → `KBD_MEMORY_MCP_URL` →
`.kbd-orchestrator/memory.config.json`'s `restEndpoint` → the local default).
`lib/kbd/memory-log.mjs`'s `mirrorHookEvent(event, ctx)` uses that probe to
mirror one hook-lifecycle event into surreal-memory as a `kbd_lifecycle_event`
entity — soft-failing by design so a memory outage never fails the lifecycle
hook it is mirroring.

---

## Quick Start Commands

### First use in a new project

```
/kbd-init               # Auto-discover project and generate .kbd-orchestrator/project.json
/kbd-new-phase <name>   # Create and activate the first phase
/kbd-assess             # Assess the active phase
```

> **IMPORTANT — project.json is GENERATED, not shipped.**
> `/kbd-init` creates full project configuration using auto-discovery. Phase
> helpers maintain `activePhase` and may bootstrap minimal missing metadata,
> preserving unrelated configuration; full discovery still belongs to `/kbd-init`.
> It lives in the project repository, not in this skill directory.
> The skill ships the generation template at
> `skills/kbd-init/references/schemas/project.template.json` and the writer
> contract at `skills/kbd-init/references/schemas/project.schema.json`.
> Never commit project-specific values into the skill files.

### Ongoing workflow

- `/kbd-init [--force] [--dry-run]` — Initialize or re-initialize project context
- `/kbd-new-phase <name>` / `/kbd-next-phase` — Create or advance a phase
- `/kbd-new-child` / `/kbd-next-child` / `/kbd-child-exit` — Manage nested phases
- `/kbd-apply <change>` — Drive each task and its lifecycle hooks
- `/kbd-assess [phase-name]` — Assess current codebase against active phase goals
- `/kbd-analyze [phase-name]` — Research engineering landscape between Assess and Spec
- `/kbd-spec [phase-name]` — Turn assessment + analysis into concrete change specs
- `/kbd-plan [phase-name]` — Create prioritized change list for current phase
- `/kbd-execute [phase-name]` — Dispatch and coordinate work through the completed Execute boundary
- `/kbd-reflect [phase-name]` — Generate phase reflection report + seed next phase
- `/kbd-status` — Show current phase, change inventory, and waypoint-guided next action
- `/kbd-audit` — Inspect causal history, ownership, and drift, read-only
- `/kbd-pause` — Checkpoint and suspend the active run
- `/kbd-resume` — Resume a paused run at a validated plan revision
- `/kbd-cancel` — Gracefully terminate the active run
- `/kbd-evolve [name]` — Domain-landscape-first evolution when the roadmap is empty or exhausted
- `/kbd-goal-check` — Impartial stopping-condition check for a goal-driven phase, separate from the implementer turn

See each sub-skill's own `SKILL.md` for its detailed invocation contract.

---

## Shipped capabilities and limits

The following skills and matching `scripts/*.mjs` helpers are shipped:

- `kbd-new-phase`, `kbd-next-phase`, `kbd-new-child`, `kbd-next-child`, and
  `kbd-child-exit` create, activate, and navigate phase hierarchies.
- `kbd-apply` drives tasks and KBD boundary hooks through the backend adapters.
- `kbd-bottleneck-detector`, `kbd-inject-agent-rules`, and `kbd-memory-recall`
  provide boundary checks, rule injection, and prior-context retrieval.

A shipped wrapper still depends on its documented runtime/service prerequisites;
report its actual result. Spec Kit execution is not ported. The upstream
evolver-bridge read-back is also absent from this port’s plan/reflect flow;
do not claim that an `evolver-bridge.json` file is automatically consumed.
