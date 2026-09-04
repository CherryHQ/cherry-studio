# Conversation Owner Deletion Decoupling

## Status

Design decisions approved on 2026-09-04; written specification pending review.

## Context

Agent Sessions and Assistant Topics are durable conversations whose configurable owner may be moved to the Recycle Bin or permanently deleted. Their nullable foreign keys already use `ON DELETE SET NULL`, but the active read and restore behavior is asymmetric:

- Topic reads treat a missing or trashed Assistant as unlinked, while Agent Session reads hide Sessions that still reference a trashed Agent.
- Agent cascade restore uses the parent's deletion timestamp to identify the Sessions moved with it, while Assistant restore does not restore the Topics moved with it.
- Renderer deletion entry points currently force cascade deletion even though both deletion contracts already default to preserving children.

The repair makes owner deletion an explicit user choice while preserving conversations, existing process boundaries, and the current Recycle Bin contract.

## Terminology

- **Unlinked Session**: an active Session without an active Agent. It remains readable but cannot execute until assigned to an active Agent.
- **Unlinked Topic**: an active Topic without an active Assistant. It remains readable and may be assigned to an active Assistant.
- **Standalone deletion**: move only the Agent or Assistant to the Recycle Bin; its active conversations remain active and become unlinked.
- **Cascade deletion**: move the owner and its currently active conversations to the Recycle Bin in one reversible transaction.

`CONTEXT.md` is the canonical glossary for these terms.

## Goals

- Let the user choose standalone or cascade deletion each time an Agent or Assistant is moved to the Recycle Bin.
- Default every confirmation to standalone deletion.
- Keep active conversations visible as unlinked when their owner is trashed, absent, or permanently deleted.
- Restore exactly the still-trashed conversations moved by the same cascade operation.
- Allow a child conversation to be restored and reassigned independently while its former owner remains in the Recycle Bin.
- Preserve Agent task and channel configuration across soft deletion while preventing execution by an inactive Agent.
- Keep the current Agent IpcApi and Assistant DataApi boundaries.

## Non-goals

- Adding a `trashOperationId` column or any other schema migration.
- Remembering the user's previous cascade checkbox choice.
- Showing a preflight count of related Sessions or Topics.
- Rebuilding pins, tags, Assistant groups, or prompt bindings removed by the existing Recycle Bin contract.
- Introducing a generic cross-domain deletion framework or extending `packages/ui` with business deletion semantics.
- Changing message, attachment, workspace, export, or rename behavior for active conversations.

## Alternatives Considered

### Align the owning domain services — selected

Agent/Session and Assistant/Topic keep their existing public boundaries. Their owning services perform the parent and optional child mutations in one transaction, active read models expose unlinked conversations consistently, and a feature-level confirmation component supplies the existing boolean options.

This touches the data, runtime, and renderer layers, but each concern remains with its current owner and all deletion entry points share the same contract.

### Orchestrate parent and child deletion in the renderer

The renderer could delete the owner, enumerate its children, and delete them separately. This produces partial-failure windows, duplicates business logic across deletion surfaces, and cannot guarantee a reversible parent-child batch. It is rejected.

### Add a persistent deletion-operation identifier

A `trashOperationId` would identify cascade batches without timestamp ambiguity. It requires a migration and new cross-resource state despite the existing Agent timestamp convention being sufficient for UI-reachable operations. It is rejected.

## Data Model and Ownership

No schema changes are required:

- `agent_session.agentId` remains nullable with `ON DELETE SET NULL`.
- `topic.assistantId` remains nullable with `ON DELETE SET NULL`.
- `deletedAt` remains the soft-delete marker and cascade batch identity.

An active conversation and an active owner are independent states. A Session or Topic is active when its own `deletedAt` is null. Its owner is usable only when the referenced Agent or Assistant exists and its `deletedAt` is null.

General history reads include every active conversation regardless of owner state. Owner-addressable reads and runtime admission additionally require an active owner. This distinction belongs in `AgentSessionService` and `TopicService`; renderer grouping must not compensate for a service that hides valid history.

The unlinked classification includes all three cases:

1. the foreign key is null;
2. the referenced owner row no longer exists;
3. the referenced owner is in the Recycle Bin.

Reassigning a conversation validates that the new owner is active and replaces the retained foreign key. Restoring a former owner never overwrites that explicit reassignment.

## Delete Semantics

### Standalone deletion

The owner service soft-deletes only the Agent or Assistant. Active children retain their foreign keys and remain active. Because their owner is no longer active, read models project them into the corresponding unlinked group.

Restoring the owner makes any retained, unmodified foreign-key relationship active again without a child write.

### Cascade deletion

The owner service generates one `trashedAt` timestamp inside the write transaction and applies it to:

- the active owner row;
- only the owner's currently active child rows selected for the cascade.

Children already in the Recycle Bin are not updated and therefore do not join the new batch. The result contains the child IDs actually moved so renderer tab cleanup remains exact.

Agent deletion continues through `AgentService.deleteAgentForDelivery()` and `AgentSessionDeliveryService`. Assistant deletion continues through `AssistantService.delete()` and its DataApi handler. The renderer passes only the existing `deleteSessions` or `deleteTopics` option; it never issues child deletes itself.

### Permanent deletion

Permanent deletion remains item-scoped in the Recycle Bin UI. Deleting an owner row permanently leaves child rows in their current active or trashed state, and the database foreign key changes their owner ID to null. Those children remain independently restorable.

The existing request shapes remain compatible, but owner services treat the cascade option as false whenever `permanent` is true. They do not infer cascade from a previous soft-delete batch, so an unexpected caller cannot broaden permanent deletion beyond the selected owner.

## Restore Semantics

Restoring an owner runs in one write transaction:

1. read the owner's non-null `deletedAt` value;
2. restore the owner;
3. restore child rows whose owner foreign key still matches and whose `deletedAt` exactly equals the parent's saved value.

This gives the following behavior without a new operation table:

- a child trashed before the cascade stays trashed;
- a child independently restored before its owner no longer matches because its `deletedAt` is null;
- an independently restored and reassigned child retains its new owner;
- a second parent-restore request follows the existing stale/not-found handling without changing child state.

Session restore removes the current prohibition against restoring beneath a trashed Agent. The restored Session appears under Unlinked Agent and remains non-addressable until its Agent is restored or changed. Topic restore follows the same rule beneath a trashed Assistant.

Pins, tags, Assistant groups, and prompt bindings continue to follow the existing Recycle Bin contract and are not reconstructed during restore.

## Agent Runtime Lifecycle

The committed database state is authoritative. Once the Agent deletion transaction commits, runtime cleanup cannot make that deletion become unsuccessful.

For every affected Session, regardless of standalone or cascade choice, `AgentSessionDeliveryService`:

- pauses the active turn;
- closes the Session runtime;
- republishes prepared delivery changes;
- causes queued deliveries to revalidate against the now-inactive Agent.

No queued or active request falls back to a default or different Agent. Runtime cleanup uses settled results, logs failures through `loggerService`, and does not reject an otherwise committed delete. Runtime admission continues to require an active Agent, so a failed close cannot start new work. Task and channel startup reconciliation repair their persistent side effects.

Assistant deletion adds no mixed-effect orchestration. An already-started Topic response retains the existing stream behavior; later sends require an active Assistant.

## Agent Tasks

`AgentJobsService` remains the Agent-task lifecycle owner and responds to the existing Agent lifecycle events:

- On trash, it disables only enabled `agent.task` schedules and writes `metadata.agentTrash.resumeOnRestore = true` on those schedules.
- On restore, it re-enables only marked schedules and removes the marker.
- On permanent deletion, it removes the schedules; existing foreign keys remove channel subscriptions while historical job rows retain their current behavior.
- On startup, it reconciles active, trashed, and missing Agent owners.

The marker belongs to each task because `enabled` is the task state being changed. No child-ID snapshot is stored on the Agent. The Session cascade checkbox does not affect tasks.

## Agent Channels

`agent_channel.isActive` remains the user's desired configuration and is not changed when an Agent enters the Recycle Bin. Runtime connection eligibility is:

```text
channel.isActive && channel.agentId is present && referenced Agent is active
```

`ChannelManager` owns this gate consistently in startup and `syncChannel()` and responds to Agent lifecycle events:

- trash disconnects every adapter for the Agent;
- restore synchronizes the Agent's channels and reconnects only rows whose `isActive` remains true;
- permanent deletion disconnects adapters, while `ON DELETE SET NULL` preserves the channel record without an Agent relationship.

Connection and disconnection failures are logged and reconciled later; they do not roll back Agent data. No restore marker is required because `isActive` was never overwritten. The Session cascade checkbox does not affect channels.

## React and UI Design

A feature-level `DeleteConversationOwnerConfirmDialog` composes existing `@cherrystudio/ui` primitives. It does not extend `ConfirmDialog`, `popup.confirm`, `ConfirmActionPopup`, or the generic Action Registry with Agent/Assistant-specific fields.

Its controlled public inputs are limited to the current consumers:

- owner type (`agent` or `assistant`);
- open and loading state;
- open-state callback;
- `onConfirm(deleteChildren)` callback.

The component owns one local checkbox state initialized to false. It renders `Checkbox` and `Label` in `ConfirmDialog.content`, associates them with `useId()`, disables them while the action is pending, and maps Radix checked state through `checked === true`.

The state resets from close/open interaction handling or component remount, never from an Effect. Changing the owner target remounts the stateful body through a stable owner key so one owner's choice cannot leak into another confirmation.

Imperative deletion surfaces use a feature-level `createPopup` wrapper around the same dialog. The popup runs `action(deleteChildren)` behind the confirm loading state, stays open after a failed action, and preserves the existing single-flight popup contract. The Resource Catalog's existing parent-owned dialog uses the controlled component directly.

The checkbox copy is:

- Agent: “Also move related sessions to the Recycle Bin” / “同时将关联会话移入回收站”.
- Assistant: “Also move related topics to the Recycle Bin” / “同时将关联话题移入回收站”.

The main action remains “Move to Recycle Bin”. No child count is fetched or displayed.

Protected built-in Agents cannot be deleted. Their existing command is renamed to “Delete all sessions”, shows no cascade checkbox, moves only active Sessions to the Recycle Bin, and leaves the Agent, tasks, and channels unchanged.

### Selection and tab behavior

- Standalone deletion keeps active child tabs open and preserves the selected Session or Topic. After owner refresh, the conversation is rendered in the unlinked state and offers reassignment.
- Cascade deletion closes only the child tab IDs returned by the backend and selects the existing nearest/latest replacement.
- Undo of standalone deletion restores only the owner; retained children regroup automatically.
- Undo of cascade deletion restores the owner and exactly its still-trashed same-batch children.

### React performance constraints

The component follows the applicable Vercel React practices:

- interaction work stays in event handlers rather than Effects;
- checkbox state is local source state, while labels and mode booleans are derived during render;
- simple primitive expressions are not wrapped in `useMemo`;
- component definitions stay at module scope;
- no extra child-count request or sequential data-fetch waterfall is introduced;
- independent post-action refreshes continue to run concurrently;
- `startTransition` is not used for destructive pending state because loading and disabled feedback are urgent.

Renderer code continues importing public UI primitives from the repository-supported `@cherrystudio/ui` package entry. That repository contract takes precedence over the generic direct-import recommendation for third-party barrel packages; internal `packages/ui` implementation continues using its documented direct paths.

## Error Handling

- A database error rolls back the parent and child writes, leaves the confirmation open, and displays an error that permits retry.
- A stale target refreshes the affected read models and uses the existing “already moved” feedback.
- A post-commit runtime, channel, or refresh failure is logged and reconciled without misreporting the committed data mutation as failed.
- Checkbox state is immutable while confirmation work is pending, preventing the displayed choice from diverging from the submitted option.
- Permanent deletion and retention cleanup remain idempotent for children already restored, reassigned, or purged.

## Documentation

- Keep `CONTEXT.md` as the glossary for linked and unlinked conversation ownership.
- Update the existing Recycle Bin breaking-change entry to describe the standalone default, optional cascade behavior, symmetric parent restore, and independent child restore.
- Update Agent unlinked-group help text to explain that the Session can continue after reassignment, matching the existing Assistant guidance.

## Verification

### Data services

- Active Session list, by-ID, latest, and search reads include Sessions whose Agent is trashed while addressable-only reads exclude them.
- Standalone owner deletion retains active children and their foreign keys.
- Cascade deletion gives the owner and only active selected children one timestamp.
- Parent restore selects only still-trashed same-owner, same-timestamp children.
- Child restore under a trashed owner succeeds and appears unlinked.
- Reassignment prevents a later former-owner restore from reclaiming the child.
- Permanent owner deletion nulls foreign keys without changing child trash state.
- A child mutation failure rolls back the parent mutation.

### Runtime services

- Both Agent deletion choices stop current Session execution and prevent queued fallback.
- Runtime-close failure is logged without changing a successful delete result.
- Task trash/restore/purge and startup reconciliation preserve only the intended enabled state.
- Channel startup, sync, trash, restore, and purge honor both channel desired state and Agent lifecycle state.

### Renderer

- Every Agent and Assistant owner-deletion entry point starts unchecked.
- Checked and unchecked confirmation deliver the correct existing boolean option.
- Reopening or changing the target resets the option to unchecked.
- Pending state disables cancel, confirm duplication, and checkbox changes; failure keeps the dialog open.
- Protected built-in Agent confirmation has no checkbox and invokes only session deletion.
- Standalone deletion preserves child tabs; cascade deletion closes exactly the returned child IDs.
- Tests query the dialog, checkbox, label, and buttons by accessible role and name rather than classes or DOM shape.

### Repository gates

Run focused main and renderer tests first, then i18n synchronization and checks. Because the final implementation crosses data services, IPC, runtime lifecycle, and renderer UI, run `pnpm lint`, `pnpm docs:check`, `pnpm test:lint`, and `pnpm build:check` before completion. No migration generation or migration check is required because the schema is unchanged.

## Acceptance Criteria

1. An unchecked Agent or Assistant deletion preserves all active child conversations and displays them as unlinked.
2. A checked deletion moves the owner and its currently active children to the Recycle Bin atomically.
3. Restoring an owner restores exactly the still-trashed children moved in that cascade operation.
4. A child can be restored and reassigned independently without being reclaimed by the former owner.
5. Unlinked Sessions remain readable but cannot execute until assigned to an active Agent.
6. Task and channel configuration survives Agent trash while execution remains stopped; only previously enabled behavior resumes after restore.
7. Permanent owner deletion leaves children independently recoverable and nulls their owner foreign key.
8. All deletion entry points use the same default, copy, boolean mapping, tab behavior, and protected-Agent exception.
