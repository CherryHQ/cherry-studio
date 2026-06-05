# Renderer Transport — Reviewer Cluster

## Scope

| Subpath | Files | Role |
|---|---|---|
| `src/renderer/src/transport/` | `IpcChatTransport.ts`, `streamDispatchCoordinator.ts`, `TopicStreamSubscription.ts` | AI SDK `ChatTransport` adapter + per-execution demux + topic-level subscription |
| `src/renderer/src/hooks/` (transport-adjacent) | `useChatContext.ts`, `useChatWithHistory.ts`, `useTopicStreamSubscription.ts`, `useTopicStreamStatus.ts`, `useTopicMessagesV2.ts`, `useTopicDbRefreshOnTerminal.ts`, `useTopicAwaitingApproval.ts`, `useToolApprovalBridge.ts`, `useExecutionOverlay.ts`, `V2ChatContext.ts`, `ToolApprovalContext.ts` | React hooks that consume the transport |
| Tests | `transport/__tests__/`, `hooks/__tests__/` | Per-file coverage |

## Intent

The renderer was the home of `useChat({ transport: Chat })` and the
hundreds-of-lines `ChatSessionManager` that pulled `streamText` directly.
v2 replaces both with:

1. A thin `IpcChatTransport` that AI SDK's `useChat` plugs into.
2. A coordinator that turns each `sendMessages` into a single
   `Ai_Stream_Open` IPC and observes the ack.
3. Per-topic subscription hooks that read from a topic-level stream
   (not a per-message Chat instance) so the renderer doesn't have to
   own a `Chat` per message.

Architecture: [`docs/references/ai/ipc-transport.md`](../../../docs/references/ai/ipc-transport.md).

## Key changes

### `IpcChatTransport`

`ChatTransport<CherryUIMessage>` implementation. Two methods:

- `sendMessages({ trigger, chatId, messages, ... })` — packages
  `AiStreamOpenRequest`, dispatches via `streamDispatchCoordinator`.
  Trigger is `'submit-message'` (sends `userMessageParts`) or
  `'regenerate-message'` (sends only `parentAnchorId`). Approval-driven
  resumption is NEVER inferred from message-state introspection — it
  goes through the explicit `Ai_ToolApproval_Respond` IPC.
- `reconnectToStream()` — calls `window.api.ai.streamAttach` so the
  renderer can subscribe after route-change / window-mount.

### `streamDispatchCoordinator`

Sits between the transport and the IPC call. Per topic:

- **Single in-flight** — coalesces concurrent `dispatch` calls into
  one IPC.
- **Observable ack** — exposes `userMessageId`, placeholder ids, and
  `executionIds` from the IPC reply (instead of being discarded by
  AI SDK's transport interface).

Consumers (e.g. agent submit) observe the ack via
`coordinator.observeAck(topicId)` so they can join the optimistic UI
bubble to the persisted row.

Commit `a73e580f5 refactor(stream-ack): surface streamOpen ack via a dispatch coordinator`.

### `TopicStreamSubscription` — ref-counted attach + per-execution demux

`src/renderer/src/transport/TopicStreamSubscription.ts`. Owns one
`Ai_Stream_Attach` per topic, ref-counted across executions. Each
`register(executionId)` returns a `ReadableStream<UIMessageChunk>`
carrying only the chunks Main tagged with that execution; the last
`unregister` triggers `streamDetach` (deferred a tick so a transient
`activeExecutions` flicker doesn't detach-then-reattach). Terminal
events (`Ai_StreamDone` / `Ai_StreamError`) close the matching branch
and fan out an `ExecutionTerminal = { isAbort, isError }`.

**Cancellation layering** is the invariant reviewers should check:
this class only manages the renderer-local subscription
(`streamAttach` / `streamDetach`). It NEVER calls `Ai_Stream_Abort` —
generation abort is `useChatWithHistory.stop`'s job. Closing branches
== "renderer stops listening; Main keeps generating".

Commit `c6eb28e44 feat(topic-stream-sub): add topic-level subscription with per-execution demux`.

### `useExecutionOverlay` — same merge function as Main

`src/renderer/src/hooks/useExecutionOverlay.ts`. The renderer's
counterpart to Main's `pipeStreamLoop` — both sides run
`readUIMessageStream` against the **same** `UIMessageChunk` stream, so
the overlay the user sees streaming and the message Main persists are
structurally identical. There is no parallel chunk-assembly code on
the renderer that could drift from AI SDK upstream.

Three structural points reviewers should check:

- **One reader per turn**, not a reused AI SDK `Chat`. A `Chat` carries
  `state.messages` across turns; reusing it produced "previous answer +
  new stream" pollution in early v2 builds.
- **Seed rule.** Each reader is seeded with the message whose id is
  the execution's `anchorMessageId`, read from the current DB
  (`uiMessages`) at reader-start time, never carried across turns. For
  a fresh placeholder the row is empty; for tool-approval / continue
  the row carries the prior assistant parts so a streamed `tool-output`
  chunk merges onto its matching `tool-input` by `toolCallId`.
- **Overlay teardown is monotonic.** `disposeOverlay(messageId)` runs
  in the `.finally` of the DB refresh in `V2ChatContent`, NOT on
  terminal — that ordering kills the flash between streaming parts
  and persisted parts.

Snapshots are retained after the reader closes (for the brief window
between stream-end and DB-refresh-complete) and dropped on
`disposeOverlay`, `reset`, restart, or topic switch.

See [`docs/references/ai/execution-overlay.md`](../../../docs/references/ai/execution-overlay.md)
for the full design.

Commit `ab9b39fb7 refactor(execution-overlay): replace per-execution Chat with readUIMessageStream readers`.

### `useTopicStreamStatus(topicId)`

Reads `topic.stream.statuses.<topicId>` from the shared cache (the
cross-window source of truth for `pending` / `streaming` /
`awaiting-approval` / `done` / `error` / `aborted` + broadcast-completion
anchor ids). `classifyTurn(status)` decodes the status into UI
predicates.

### `useTopicAwaitingApproval(topicId)`

Returns `true` when the topic is paused on approval. Single source of
truth — reads `useTopicStreamStatus(topicId).status` and runs it through
`classifyTurn(...).isAwaitingApproval`. No per-window `partsMap`
introspection (that pattern caused cross-window drift and is what
moved off the renderer in this refactor).

### `useToolApprovalBridge`

Posts the user's decision to Main via `Ai_ToolApproval_Respond`.
Crucially **does not** PATCH `applyApprovalDecisions` itself — Main is
the single writer. See
[`docs/references/ai/tool-approval.md`](../../../docs/references/ai/tool-approval.md).

## Invariants

- `useChat({ id: topicId, transport: IpcChatTransport })` is the only
  consumer pattern. No code should call `window.api.ai.streamOpen`
  directly outside the transport.
- The renderer is never the source of truth for streaming state — every
  status read goes through `useTopicStreamStatus` (shared cache) or the
  per-execution overlay.
- `useToolApprovalBridge` does not write to any local cache; it only
  posts IPC.
- Overlay teardown is monotonic: it's released only after the DB refresh
  resolves (success or failure — see the `.finally` in `V2ChatContent`).
- `TopicStreamSubscription` never calls `Ai_Stream_Abort` — only
  `streamDetach`. Anything in this layer that touches abort is in the
  wrong place.
- Renderer chunk assembly goes through `readUIMessageStream`. Any
  hand-rolled `UIMessageChunk` → message accumulator is wrong; it will
  drift from Main's accumulator on the next AI SDK chunk-type change.
- The execution-overlay seed is read from `uiMessagesRef.current` at
  reader-start time, never carried across turns.

## Validation

- `transport/__tests__/IpcChatTransport.test.ts`
- `transport/__tests__/streamDispatchCoordinator.test.ts`
- `transport/__tests__/TopicStreamSubscription.test.ts` — ref-counted
  attach, per-execution branch demux, terminal fan-out
- `hooks/__tests__/useExecutionOverlay.test.ts` (if present) — seed
  rule, snapshot retention, terminal handoff
- Commits `ed905ca45 refactor(v2-chat): broadcast awaiting-approval anchor ids`
  and `3b2fb0752 refactor(v2-chat): consolidate turn-state behind single table-driven classifier`
  for the classifier consolidation.

## Follow-ups (out of scope)

- Stream resume across renderer crash (currently scoped to route-change
  reconnects).
- See memory [Consolidate, don't reconcile split-brain state](../../../)
  — the v2 chat consolidation is the application of that principle here.
