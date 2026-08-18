# IPC Transport

## What it is

`IpcChatTransport`
(`src/renderer/services/aiTransport/IpcChatTransport.ts`) implements AI SDK's
`ChatTransport<CherryUIMessage>` over Electron IPC. The renderer feeds
it into `useChat({ id: topicId, transport: ... })`. The `ChatTransport`
interface has only two methods — `sendMessages` / `reconnectToStream`;
the transport relays each over `window.api.ai.stream*` to Main's
`AiStreamManager`. `cancel` is **not** a transport method: it is the
`cancel` callback of the `ReadableStream` that `sendMessages` returns
(AI SDK invokes it on unmount/disposal), and abort is driven by the
request's `abortSignal`.

```
useChat({ id: topicId, transport: new IpcChatTransport(defaultBody) })
   │  transport methods
   ├─ sendMessages         → window.api.ai.streamOpen   (Ai_Stream_Open)
   ├─ reconnectToStream    → window.api.ai.streamAttach (Ai_Stream_Attach)
   │  returned-stream / signal callbacks
   ├─ stream cancel()      → release topic attachment lease
   │                          (last window-local owner → Ai_Stream_Detach)
   └─ request abort signal → window.api.ai.streamAbort  (Ai_Stream_Abort)
```

**Detach ≠ abort.** `cancel()` (e.g. unmount/disposal) releases the transport's
lease in `StreamAttachmentService`. The service sends `streamDetach` only when
the last owner for that topic in the window releases; a concurrent
`TopicStreamSubscription` therefore cannot be detached by transport cleanup.
Detach drops *this window's* subscriber while Main keeps generating and
persists the result. Stopping generation is a separate path — the request's
`abortSignal` firing calls `streamAbort`. Conflating the two would resurrect the v1
"unmount → cancel → upstream abort → lost reply" bug class.

Per-topic chunks arrive via `onStreamChunk` listeners filtered by
`topicId`.

## Triggers

`sendMessages` distinguishes two triggers:

| Trigger | What it does |
|---|---|
| `submit-message` | Includes `userMessageParts` (the latest message) so Main persists it |
| `regenerate-message` | Sends `parentAnchorId` only; Main re-runs from the existing parent |

Cherry's transport never derives `continue-conversation` from
message-state introspection. Approval-driven resumption goes through the
explicit `Ai_ToolApproval_Respond` IPC handled by
[`useToolApprovalBridge`](./tool-approval.md).

## Dispatch coordinator

`streamDispatchCoordinator` (`src/renderer/services/aiTransport/streamDispatchCoordinator.ts`)
sits between the transport and the IPC call so the `Ai_Stream_Open` ack
(`reservedMessages`, `activeExecutions`, and `activeNodeDecision`) is
observable to callers that need to seed optimistic UI bubbles, rather than
being thrown away by AI SDK's transport interface.

It does **not** serialize sends — there is no single-in-flight guard in the
coordinator. Concurrency for a topic is arbitrated on the Main side: a chat
resubmit to a live topic is persisted and queued as a steer
(`AiStreamManager.enqueuePendingSteer`) — the running turn yields and a
continuation answers it — while an agent-session follow-up attaches to the
running stream.

## Per-execution demux

The chunk stream from Main is keyed by immutable `attemptId`; `executionId`
and `anchorMessageId` form the logical slot whose newest attempt is rendered.
`TopicStreamSubscription`
(`src/renderer/services/aiTransport/TopicStreamSubscription.ts`) owns branch
demux and holds a topic attachment lease while its subscription is active.
`StreamAttachmentService` coordinates that lease with `IpcChatTransport` and
is the only renderer code that sends `streamDetach`. The subscription demuxes
chunks into per-execution branch `ReadableStream`s, so
multi-model parallel responses render as separate AI SDK messages on
the same topic. `useExecutionOverlay` consumes each branch through
`readUIMessageStream` — the same accumulator Main runs in
`pipeStreamLoop`, so the renderer overlay and the persisted message
are structurally identical.

An attach snapshot owns the topic-level `topicOpen` value. Replayed chunks
rebuild attempt content but cannot reopen a quiescent snapshot; only a live
chunk from a current cycle can move the subscription back to open. A closed
snapshot therefore synthesizes the same quiescence handoff as a live
`topic-quiesced` barrier after replay finishes.

Legacy and v2 attach payloads are projections of one Main-side compact replay
plan. If ring eviction removed a text/reasoning start, Main emits a synthetic
start before the surviving delta. That repair event does not advance v2's
source-sequence cursor; the delta sharing its sequence must still be applied.

See [Execution Overlay](./execution-overlay.md) for the merge-function
symmetry, seed rule, cancellation layering, and lifecycle.

## Topic-level subscription

`useTopicStreamStatus(topicId)` reads
`topic.stream.statuses.<topicId>` from the shared cache. The cache is
the cross-window source of truth for:

- `pending` / `streaming` / `awaiting-approval` / `done` / `error` / `aborted`
- broadcast-completion anchor ids

`classifyTurn(status)` decodes the status into the `TurnStateFlags`
predicates the UI consumes (`isStreamLive`, `isTurnActive`,
`isAwaitingApproval`, `isTerminal`).

## Where to read more

- Code: `src/renderer/services/aiTransport/`
- Hook glue: `src/renderer/hooks/useChatWithHistory.ts`
- Per-execution overlay (renderer assembler): [Execution Overlay](./execution-overlay.md)
- Approval bridge: [Tool Approval](./tool-approval.md)
- Main side: [Stream Manager](./stream-manager.md)
