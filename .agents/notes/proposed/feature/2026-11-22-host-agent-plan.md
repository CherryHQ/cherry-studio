# Agent Note: Host-owned editable Agent plans

Status: proposed

English | [中文](2026-11-22-host-agent-plan.zh.md)

## Problem

Issue #18961 asks for a Cherry-owned task plan that survives turns, compatible runtime switches and restarts, and lets users edit pending steps. Plans already exist: `ExitPlanModeTool` displays native plan text, `TodoWriteTool` displays lists, and `agentRightPaneProjection` derives the root agent's plan from task-ledger and todo snapshots while keeping spawned processes separate. These are useful runtime projections, not one editable, revisioned host plan.

A persisted editable copy cannot silently replace native history or promise execution order that a runtime has not accepted. Free-form ExitPlanMode text also does not necessarily contain structured steps or dependencies.

## Proposal

### One session-owned plan

Store one active host plan per persisted Agent session through Main DataApi/service/database ownership. The plan contains an objective, stable step IDs, titles, dependency IDs, order, pending/in-progress/completed/error status, revision and an append-only history of accepted changes. Keep completed step text/status/history immutable to ordinary pending-step edits. A correction creates a new history entry rather than rewriting old completion evidence.

Show the host plan in the existing Agent status surface, alongside a clear origin and last-updated state. Preserve native tool cards and the separate spawned-task/run list. A host step is not a background process, a tool approval, or proof that its work ran. Session deletion removes its plan/history; migration starts empty and does not invent prior execution records. The history contains plan changes and provenance only, not copies of credentials, tool outputs or full transcripts.

### Import runtime observations without guessing

Main adapters project recognized, validated root-agent plan events into this session plan. Retain runtime kind, source turn/message/tool-call identity and source event sequence so replay is idempotent and subagent plans cannot replace the root plan. Keep raw native artifacts in their existing transcript ownership and link to them instead of duplicating them in the plan table.

A successful structured TodoWrite/task-ledger event may supply steps and statuses. Match updates by a stable runtime-to-host ID map, never by title or array position. If a runtime supplies only a whole-list snapshot with no stable IDs, import it as a proposed replacement requiring review when a host plan already exists; do not guess which completed or user-edited steps it replaces. Failed, partial, cancelled, duplicate or older source events cannot mark steps complete or roll back newer state.

ExitPlanMode text appears as a linked plan proposal/objective with its origin. Do not parse prose into invented steps or dependencies. Users can explicitly adopt the proposal and add pending steps. Adoption does not approve ExitPlanMode, settle its approval card, or start execution. Existing approval/model-handoff behavior, including work tracked in PR #21080, remains separate.

### Edit pending work safely

When the session is idle, allow the user to change the objective, edit/add/remove pending steps, and reorder them through pointer and keyboard controls. Show dependency blockers and reject missing references, self-dependencies, cycles and order that places a step before its prerequisites. Completed/in-progress steps cannot be deleted or rewritten by this editor. Do not infer dependencies from prose or rearrange steps silently.

Mutations carry the expected plan revision. Main checks session access and idle state in the same serialized mutation path, validates the graph, records the change and publishes the new revision. Concurrent windows receive a conflict and must reload/reapply their intent. An arriving native proposal cannot overwrite a user edit, and a late completion for a removed or superseded step remains traceable without reviving it. A run starting during an edit causes a safe refusal rather than a mid-turn plan mutation.

### Deliver the accepted revision at a turn boundary

A compatible runtime adapter must explicitly support receiving a host plan at the next existing user-initiated turn/resume boundary. Capture the accepted revision as part of turn preparation, deliver its objective and ordered ready steps through the runtime's supported input path, and record the delivered revision. Preserve dependencies and completed history. Never rewrite the runtime's private files or fabricate tool events to force it to accept a plan.

Show whether edits are saved, pending delivery, delivered to a named turn, or unsupported by the selected runtime. Delivery is not proof of execution: only actual linked runtime observations update progress, and a completed model turn alone does not complete every step. Runtime switches keep the host record; incompatible switches show it read-only with an explanation rather than dropping it or claiming it was applied.

Reordering means the next compatible execution receives the revised ready-step order, not that Cherry can preempt a live tool or guarantee a language model's behavior. Before completion of this feature, an integration scenario must demonstrate that a compatible adapter consumes that order and associates resulting progress with the correct step IDs. Until then, describe the layer as storage/editing only, not execution support. No automatic turn, new model call, tool approval, file change or purchase follows from editing or restoring a plan.

## Alternatives considered

- Keep only transcript projections: preserves native history but cannot provide independent pending-step edits or cross-runtime identity.
- Treat the renderer's current list as persistent truth: positional todo IDs and latest-writer projection can overwrite user changes or confuse subagent work with root steps.
- Parse every plan's Markdown into executable steps: invents dependencies, identity and completion semantics not supplied by the runtime.
- Edit native runtime files or mark approval accepted during adoption: bypasses existing runtime/approval ownership and can trigger work the user did not start.
- Inject revisions into an active turn: races spawn-frozen inputs and already-running tools; use the next supported boundary instead.

## Acceptance criteria

- AC1 — A session plan with stable steps, dependencies, statuses, revisions and change provenance survives restart and compatible runtime switch; migration starts empty and session deletion removes owned records. Native transcript cards and spawned-task tracking remain intact. (verification: database, main and Electron)
- AC2 — Recognized root-agent structured events project with stable identity and replay safety; ambiguous snapshots/prose become reviewable proposals without inventing steps, approving tools or replacing user/completed history. Child/failed/partial/stale events cannot corrupt the root plan. (verification: unit, main and renderer)
- AC3 — Idle pending-step edits and pointer/keyboard reorder persist, reject invalid graphs, and protect in-progress/completed work; competing windows, native updates and run-start races conflict safely without lost edits or revived steps. (verification: database, renderer and Electron)
- AC4 — A compatible adapter captures/delivers the accepted revision at the next user-initiated boundary and demonstrably follows revised ready-step order with correctly linked progress. Incompatible switches retain the plan and show unsupported delivery, and no restore/edit path starts work or settles approvals. (verification: main, runtime integration and Electron)
- AC5 — Saved/pending/delivered/unsupported states and origins are visible, with bilingual accessible keyboard/focus behavior and narrow/light/dark layouts. Native/tool cards and existing progress remain correct; partial layers keep the note proposed and state unverified boundaries. (verification: renderer, docs gate and Electron)

## Risks

Stable runtime identity and host-edit reconciliation are the main boundaries. Existing projection IDs are not automatically suitable database identities. Prove mapping and replay behavior before enabling edits on imported snapshots.

A host plan can mislead users if saved is confused with delivered or completed. Keep those states distinct, and do not claim ordered execution from a prompt-only fixture. A runtime that lacks a supported consumption contract must remain read-only for execution purposes.

Plan content is private session data. Store and expose it under existing session access and backup rules, preserve source provenance, and do not log full plan text. History is append-only during the session lifecycle, not exempt from session deletion.
