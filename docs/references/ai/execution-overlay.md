---
description: Renderer Conversation execution overlay, observational attachment, exact branch demux, and refresh-before-retire handoff
sources:
  - src/renderer/services/aiTransport/ConversationStreamSubscription.ts
  - src/renderer/services/aiTransport/ExecutionStreamOverlayService.ts
  - src/renderer/services/aiTransport/StreamAttachmentService.ts
  - src/renderer/hooks/useExecutionOverlay.ts
---

# Execution Overlay

The renderer combines durable SQLite/SWR messages with a process-local live
overlay. Main and Renderer both use AI SDK `readUIMessageStream`, so a chunk
sequence produces the same message shape on screen and in the terminal
snapshot.

```text
Main AiExecutionManager
  ├─ accumulate terminal snapshot
  └─ exact chunk event
       { ConversationRef, TurnId, ExecutionId, outputNodeId, chunkSeq }
                         │
Renderer ConversationStreamSubscription
  └─ execution branch → readUIMessageStream → ExecutionStreamOverlayService
                                                │
SQLite/SWR durable rows ─────────────────────────┴─ message-list projection
```

## Ownership boundaries

| Owner | State | May decide |
|---|---|---|
| `ConversationRuntimeService` | turn, execution, interaction, terminal and quiescence | admission, Stop, settlement |
| `StreamAttachmentService` | window-local observer reference counts | when this window detaches |
| `ConversationStreamSubscription` | execution branches, sequence cursors and replay | how exact chunk events reach readers |
| `ExecutionStreamOverlayService` | snapshots, optimistic rows and refresh handoff | when a durable projection is safe to reveal |
| `useExecutionOverlay` | one Conversation-bound React binding | callbacks and seed rows for that exact Conversation |

Attachment and overlay state are projections. Closing the last renderer reader
never aborts generation. Stop is the separate `ai.stream.abort` Conversation
command.

## Exact execution demux

Each branch is keyed by `ConversationExecutionId`. Its projection also carries
the owning `TurnId`, provider model, and durable `outputNodeId`. Main assigns a
monotonic `chunkSeq`; duplicates and older chunks are ignored rather than
guessed onto a current branch.

`ConversationStreamSubscription.register` creates the `ReadableStream`
controller synchronously. Chunks received before React starts reading are
therefore retained by the stream queue. Attach returns compact buffered chunks
with the same exact identity and sequence rules; there is no cycle, attempt, or
control-revision protocol in Renderer.

Attach is atomic from the observer's perspective: Main registers the observer
before capturing per-execution high-water, and Renderer buffers concurrently
arriving events until it has applied snapshot and replay. A Live snapshot may
already contain settled siblings. NotFound requests a durable refresh; an IPC
error remains retryable and neither condition fabricates terminal success.

## Seed rule

An execution writing an existing assistant row starts from a clone of that
row. A missing row gets an empty assistant seed with the exact `outputNodeId`.
`seedFromEmpty` explicitly discards old persisted parts for regeneration. The
seed is cloned because `readUIMessageStream` mutates parts while assembling.

## Terminal and durable handoff

Execution terminal closes only the matching branch. Conversation terminal marks
the Turn quiescent. `ExecutionStreamOverlayService` then:

1. keeps the settled overlay visible;
2. invokes the latest refresh port for the same `ConversationRef`;
3. waits for the SQLite/SWR refresh to succeed;
4. retires only records whose `TurnId` matches the quiesced turn.

On refresh failure the overlay is retained and exposes `refreshError`; durable
content is never replaced by a known-stale projection.

Every committed execution follows this refresh-before-retire path, including
explicit reset and overlay disposal. Those APIs may delete only uncommitted
optimistic rows immediately.

## Per-Conversation React binding

`useExecutionOverlay` creates a binding containing the exact
`ConversationRef`, consumer token, seed getter, finish callback, and refresh
callback. A render from A to B creates B's binding; A's cleanup still captures
A. Consequently a delayed A finish or cleanup cannot invoke B's callbacks or
retire B's overlay.

Activity hide/show releases only the view consumer. The service retains live
readers for the same Conversation, so remounting restores the overlay without
changing Main control state.

## Invariants

- `ConversationStreamSubscription` observes; it never aborts.
- `StreamAttachmentService` is the only renderer detach owner.
- Execution identity is `ConversationRef + TurnId + ExecutionId`, not model ID
  or assistant row alone.
- A terminal overlay retires only after its durable refresh succeeds.
- Renderer refs, overlay liveness, and subscriber count never participate in
  Main admission or quiescence.
