---
description: IpcChatTransport bridging useChat to Main over ai.stream.* IpcApi routes, with dispatch ack coordination and detach vs abort
sources:
  - src/renderer/services/aiTransport/IpcChatTransport.ts
  - src/renderer/services/aiTransport/StreamDispatchService.ts
  - src/renderer/services/aiTransport/TopicStreamSubscription.ts
---

# IPC Transport

## What it is

`IpcChatTransport`
(`src/renderer/services/aiTransport/IpcChatTransport.ts`) implements AI SDK's
`ChatTransport<CherryUIMessage>` over Electron IPC. The renderer feeds
it into `useChat({ id: topicId, transport: ... })`. The `ChatTransport`
interface has only two methods — `sendMessages` / `reconnectToStream`;
the transport relays each through `ipcApi.request('ai.stream.*', ...)` to
Main's IpcApi handler and `AiStreamManager`. `cancel` is **not** a transport method: it is the
`cancel` callback of the `ReadableStream` that `sendMessages` returns
(AI SDK invokes it on unmount/disposal), and abort is driven by the
request's `abortSignal`.

```
useChat({ id: topicId, transport: new IpcChatTransport(defaultBody) })
   │  transport methods
   ├─ sendMessages         → ai.stream.open
   ├─ reconnectToStream    → ai.stream.attach
   │  returned-stream / signal callbacks
   ├─ stream cancel()      → ai.stream.detach
   └─ request abort signal → ai.stream.abort
```

**Detach ≠ abort.** `cancel()` (e.g. unmount/disposal) requests
`ai.stream.detach`: it drops *this* subscriber while Main keeps generating and
persists the result. Stopping generation is a separate path — the request's
`abortSignal` requests `ai.stream.abort`. Conflating the two would resurrect the v1
"unmount → cancel → upstream abort → lost reply" bug class.

## User Stop

`useChatWithHistory.stop()` starts `ai.stream.abort` before calling AI SDK's
`stop()`, then awaits both. This establishes Main's topic admission barrier
before local stream consumption ends and the UI can retry. The transport's
request `abortSignal` covers a stream opened
by `sendMessages`, but its abort callback sends IPC without exposing Main's
completion to the hook; a stream returned by `reconnectToStream()` has no
original request signal at all. The explicit idempotent IPC therefore covers
both paths and makes the hook's Stop promise resolve only after Main has crossed
the topic teardown barrier: terminal persistence is settled and, for an Agent
session, its runtime generation — including a pending connection attempt — is
closed before a retry is admitted.

Per-topic chunks arrive through `ipcApi.on('ai.stream.chunk', ...)`, filtered
by `topicId`.

## Triggers

`sendMessages` distinguishes two triggers:

| Trigger | What it does |
|---|---|
| `submit-message` | Includes `userMessageParts` (the latest message) so Main persists it |
| `regenerate-message` | Sends `parentAnchorId` only; Main re-runs from the existing parent |

Cherry's transport never derives `continue-conversation` from
message-state introspection. Approval-driven resumption goes through the
explicit `ai.tool.respond_approval` IpcApi route handled by
[`useToolApprovalBridge`](./tool-approval.md).

## Dispatch coordinator

`streamDispatchService` (`src/renderer/services/aiTransport/StreamDispatchService.ts`)
sits between the transport and the IPC call so the `ai.stream.open` ack
(`reservedMessages`, `activeExecutions`, and `preserveActiveNode`) is
observable to callers that need to seed optimistic UI bubbles, rather than
being thrown away by AI SDK's transport interface.

It does **not** serialize sends — there is no single-in-flight guard in the
coordinator. Concurrency for a topic is arbitrated on the Main side: a chat
resubmit to a live topic is persisted and queued as a steer
(`AiStreamManager.enqueuePendingSteer`) — the running turn yields and a
continuation answers it — while an agent-session follow-up attaches to the
running stream.

## Per-execution demux

The chunk stream from Main is keyed by `(topicId, executionId)`.
`TopicStreamSubscription`
(`src/renderer/services/aiTransport/TopicStreamSubscription.ts`) owns the
topic-level `ai.stream.attach` / `ai.stream.detach` requests with ref-counted lifecycle
and demuxes chunks into per-execution branch `ReadableStream`s, so
multi-model parallel responses render as separate AI SDK messages on
the same topic. `useExecutionOverlay` consumes each branch through
`readUIMessageStream` — the same accumulator Main runs in
`pipeStreamLoop`, so the renderer overlay and the persisted message
are structurally identical.

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
