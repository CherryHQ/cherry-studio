---
description: Shared root and child message projections, bounded attachment recovery, and root overlay handoff
sources:
  - src/shared/ai/messageProjection.ts
  - src/main/ai/messages/MessageProjection.ts
  - src/main/ai/messages/ProjectionSubscriptions.ts
  - src/main/ai/streamManager/TopicMessageProjection.ts
  - src/main/ai/agentSession/ChildThreadProjection.ts
  - src/renderer/services/aiTransport/MessageProjectionService.ts
  - src/renderer/services/aiTransport/ExecutionStreamOverlayService.ts
  - src/renderer/hooks/useExecutionOverlay.ts
  - src/renderer/hooks/agent/useAgentChildProjection.ts
---

# Execution Overlay

## Ownership and message model

Root conversations and children use `CherryUIMessage`. Each native owner has an independent projection. Root messages come from the existing `readUIMessageStream` accumulator in `pipeStreamLoop`; child messages come from `ThreadMessageProjection` and native archive reconciliation. The renderer receives message snapshots and patches, without running another SDK reader.

```text
Root SDK accumulator → TopicMessageProjection ─┐
Child native observer → ChildThreadProjection ─┤
                                              ↓
                              MessageProjection / ProjectionSubscriptions
                                              ↓ ai.projection.*
                                   MessageProjectionService
                                    ↙                   ↘
                       useExecutionOverlay      useAgentChildProjection
```

A root baseline covers the current live overlay, not the topic's saved history. It includes execution, attempt and message-anchor identities, so parallel models and a retry using the same model/anchor stay distinct. The child baseline covers its own archive and current content; it excludes parent and sibling content. `toolCallId` resolves a child through its owner and is not the child's durable identity.

Native queues, child lifetime and persistence destinations remain owner-specific. Observing or detaching a view does not submit input, stop a task, or transfer native ownership. Parent completion does not finish a background child's projection. Native owner closure makes the child unavailable while retaining its readable archive.

## Publication

`MessageProjection` shares diffing, immutable baselines and subscriber delivery. A changed message is upserted; text/reasoning growth with otherwise unchanged structure uses an append patch. Every update carries the complete message order, which also expresses removal. Unchanged messages and parts keep stable references in the renderer.

Root updates coalesce into one pending view over 80 ms. Child reconciliation already batches native updates and writes its archive before publication, so it publishes immediately after that work. Revisions count published batches, not model chunks. Capturing a baseline flushes pending accepted content first.

A root terminal is published in the notification phase, after terminal persistence. The final view includes accepted content and the final execution state in the same revision. Persistence failure publishes an `unresolved` execution with readable content and an error; it does not signal a successful DB handoff. Host-resolved approvals are folded into Main's snapshots so a later SDK snapshot cannot restore a dismissed approval card.

## Attachment and recovery

`ai.projection.attach` accepts a topic or child target and a window-owned subscription ID. Main resolves the owner, registers delivery and captures a baseline without an asynchronous gap between registration and snapshot. A cancelled or replaced asynchronous attachment cannot install a listener. Window destruction removes its delivery leases.

The renderer listens before attaching and buffers up to 100 early updates. It installs the baseline, ignores covered revisions and applies only the next consecutive revision. A gap, invalid patch or buffer overflow starts a new attachment with a new subscription ID. Late responses and events from old subscriptions are ignored. This recovers the current view; it is not a durable event journal or a TCP-style retransmission protocol.

The store shares one transport subscription among consumers of the same target in a window. The last consumer detaches it. No renderer subscription controls the lifetime of native work. A retained root facade may display its last view while a remount obtains the current baseline; its inactive cache is bounded to 32 topics.

## Root rendering and DB handoff

`ExecutionStreamOverlayService` turns a topic projection into message-ID-to-parts overlays and live assistant messages. `useExecutionOverlay` binds that facade to React and forwards update/finish notifications for speech and error presentation. It does not seed a reader from renderer history.

- Update routing retains the execution attempt and anchor. A stale active-execution cache cannot overwrite a newer attempt.
- Finish callbacks occur once per observed attempt. Replayed or duplicate revisions do not repeat completion.
- A completed overlay stays readable until the consumer refreshes its existing message store and calls `reset` or `disposeOverlay`.
- A delayed handoff leaves active and unresolved attempts intact. Explicit `clear` hides the current attempt even if it continues producing frames.
- Topic status and approval indicators still use the existing shared-cache status entries. Those entries do not contain the streamed body.

Home Chat, Agent Chat, Quick Assistant and Selection all consume this projection path. Their command hooks send input and stop requests separately; child input still goes through the owning runtime's child-message command.

## Related references

- [IPC Transport](./ipc-transport.md) — command and observation routes.
- [Stream Manager](./stream-manager.md) — execution, SDK accumulation and terminal persistence.
- [Agent Session Runtime](./agent-session-runtime.md) — session and child ownership.
