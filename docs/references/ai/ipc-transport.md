---
description: IpcChatTransport and Conversation stream protocol, including dispatch acknowledgements, exact identities, detach, and Stop
sources:
  - src/renderer/services/aiTransport/IpcChatTransport.ts
  - src/renderer/services/aiTransport/StreamDispatchService.ts
  - src/renderer/services/aiTransport/ConversationStreamSubscription.ts
  - src/renderer/services/aiTransport/StreamAttachmentService.ts
---

# IPC Transport

`IpcChatTransport` implements AI SDK `ChatTransport<CherryUIMessage>` over the
`ai.stream.*` IpcApi routes. The protocol addresses a Chat or Agent through an
exact `ConversationRef`; it never synthesizes an Agent Topic ID.

```text
sendMessages      → ai.stream.open  → Conversation actor FIFO
reconnectToStream → ai.stream.attach ─┐
chunk/done/error  ← exact execution events
stream cancel     → release observer ─┴→ last local owner: ai.stream.detach
abort signal      → ai.stream.abort → Conversation Stop
```

Detach and Stop are intentionally different. Detach removes only this window's
observer; Main continues the execution and terminal persistence. Stop asks the
Conversation owner to select a terminal outcome and abort exact live resources.

## Open commands

`sendMessages` maps AI SDK triggers at the boundary:

| `ConversationOpenTrigger` | Payload |
|---|---|
| `SubmitMessage` | exact Conversation, user parts, optional tree anchor, models and reasoning |
| `RegenerateMessage` | exact Conversation and replacement tree anchor |

The resulting `AiStreamOpenResponse` includes its mode, reserved durable rows,
active execution projections, and active-node decision. `StreamDispatchService`
publishes that acknowledgement to optimistic UI consumers; it does not own
serialization or admission.

Active Chat input is committed to `Inbox.NextTurn` and requests a clean yield.
Active Agent input is committed to `Inbox.NextStep` only when the Agent profile
and driver accept redirect; otherwise it remains `Inbox.NextTurn`. These are
Conversation decisions, not transport inference.

While an execution is WaitingInteraction, ordinary Chat and Agent input always
targets `Inbox.NextTurn`; the transport does not yield or redirect the waiting
execution.

## Stream events

Every chunk carries:

```text
ConversationRef + TurnId + ExecutionId + modelId + outputNodeId + chunkSeq
```

Done and error events carry the same identity plus `turnTerminal`. A terminal
for one execution closes only that branch; a turn terminal closes the aggregate
transport stream. The renderer does not compare cycles, attempts, watermarks,
or control revisions.

`ConversationStreamSubscription` exclusively owns per-execution chunks, replay,
and branch settlement for overlays. `IpcChatTransport` owns only AI SDK's
aggregate open/turn-terminal/abort stream; it does not maintain a second chunk
pipeline. Both acquire their observer lease through `StreamAttachmentService`,
which sends `detach` only after the last window-local owner releases it.

## Attach snapshots

`ai.stream.attach` returns a discriminated `Live`, `Settled`, or `NotFound`
snapshot. Main registers the observer before capturing each execution's replay
high-water. Renderer temporarily buffers live events, applies snapshot and
replay, and then accepts only `chunkSeq` values above that execution's
`throughChunkSeq`.

- Live may include settled siblings beside live executions.
- Settled includes every execution terminal plus the turn terminal; it never
  invents empty final messages.
- NotFound triggers a durable refresh. It is neither EOF nor Success.
- IPC failure stays retryable and releases the failed attachment lease.
- The resource ring retains at most 10,000 raw sequenced provider events. Main
  filters by the renderer's per-execution cursor before semantic compaction;
  text/reasoning/tool deltas are split at 16 KiB without crossing a sequence
  boundary, and truncation is explicit.

## Shared status projection

`useConversationStreamStatus(ConversationRef)` reads
`conversation.statuses.<kind:id>` from shared cache. The entry contains a named
`ConversationStatus`, exact active executions, exact waiting-interaction
executions, and completion timestamp. `classifyTurn` is the exhaustive status
classifier used by Renderer. Shared cache is a projection only; Main control
decisions read the Conversation aggregate.

## Invariants

- Transport cleanup never aborts generation.
- The abort route submits Stop; it does not mutate a resource registry.
- Dispatch acknowledgement is a projection of a committed command.
- All result and stream identities are exact; no lookup of "current topic" is
  allowed.
- Agent and Chat share the protocol without sharing a synthetic identifier.
