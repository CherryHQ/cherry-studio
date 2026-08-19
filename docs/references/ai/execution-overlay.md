---
description: Renderer stream overlay — TopicStreamSubscription demux by execution and anchor feeding readUIMessageStream snapshots
sources:
  - src/renderer/services/aiTransport/TopicStreamSubscription.ts
  - src/renderer/hooks/useExecutionOverlay.ts
---

# Execution Overlay

The renderer-side counterpart of Main's `pipeStreamLoop`. Both sides
use the **same pure assembler** —
[AI SDK's `readUIMessageStream`](https://ai-sdk.dev/docs/reference/ai-sdk-ui/read-ui-message-stream) —
to turn the chunk stream into a `CherryUIMessage`. Main writes the
result to disk; the renderer paints it onto the chat surface as an
overlay above the SWR-backed history.

## Why the same merge function on both sides

`UIMessageChunk` assembly is non-trivial: text deltas merge by `id`,
reasoning blocks have their own start/delta/end, tool calls go through
`tool-input-start` / `tool-input-delta` / `tool-input-available` /
`tool-output-available`, dynamic data parts merge by key, multi-step
turns carry step boundaries. Re-implementing any of this on the
renderer would mean a second source of truth that *had* to track AI SDK
upstream, with two ways to disagree about partial state.

Running the same `readUIMessageStream` on the same `UIMessageChunk`
stream — once on Main (writing to `exec.finalMessage`), once on the
renderer (driving the overlay) — guarantees structural agreement.
What persists is exactly what the user saw streaming.

```
Main: pipeStreamLoop(stream)
   tee()
   ├─ branch A → broadcast to listeners      → WebContentsListener → IPC chunks
   └─ branch B → readUIMessageStream          → exec.finalMessage (writes to DB)
                                                                 ▲
                                                                 │ (DB write)
                                                                 │
Renderer: TopicStreamSubscription          ┌──── readUIMessageStream → snapshot
            │     │                        │              ▲
            │     ▼                        │              │
            │  routes chunks by            │       fed by branch stream
            │  executionId + anchor        │
            │  into stream branches ───────┘
            ▼
       branch ReadableStream  →  useExecutionOverlay (per execution)
```

## TopicStreamSubscription

`src/renderer/services/aiTransport/TopicStreamSubscription.ts`. A renderer
class that owns:

- **One subscription attachment lease per topic.** The first live branch
  attaches, and the subscription releases its lease after the last branch
  closes (deferred one microtask so a transient `activeExecutions` flicker
  does not detach-then-reattach). `StreamAttachmentService` coordinates this
  lease with `IpcChatTransport`; only the last window-local owner sends the
  actual `detach`.
- **Execution + anchor demux.** Each `register(executionId,
  anchorMessageId)` returns a `ReadableStream<UIMessageChunk>` for that
  model writing to that assistant row. Multi-model parallel responses
  get separate branches by `executionId`; same-model steer
  continuations get separate branches by `anchorMessageId`.
- **Anchor is part of stream identity.** `executionId` names the model,
  not the assistant row. During a steer continuation, Main can close
  A1a and immediately open A2 with the same model id. Chunks for A2 can
  arrive before React registers A2's reader, so the transport must
  buffer them under `executionId + anchorMessageId` instead of routing
  them to the closed A1a branch.
- **Synchronous controller creation.** The branch's
  `ReadableStreamDefaultController` is created during the
  `new ReadableStream({ start })` call (synchronous), so chunks that
  arrived between `register` and the reader's first `read()` are
  already buffered in the stream's internal queue — late readers never
  miss replayed chunks.
- **Terminal demux.** `ai.stream.done` / `ai.stream.error` close the
  matching branch and fan out an `ExecutionTerminal` (`{ isAbort,
  isError }`) to listeners; if the payload carries `isTopicDone` or no
  `executionId`, every branch terminates together. An explicit
  `isTopicDone=false` keeps the topic attachment alive across the empty
  continuation gap before the next branch produces its first chunk.

### Cancellation layering — do not conflate

| Layer | Owner | Action |
|---|---|---|
| Renderer-local subscription | `TopicStreamSubscription.unregister` / `dispose` | Closes the branch reader and releases its topic lease when idle; Main keeps generating |
| Generation abort | Main (via `useChatWithHistory.stop` → `ai.stream.abort`) | Stops the LLM |

`TopicStreamSubscription` NEVER aborts the LLM. Closing all branches releases
its attachment lease; `StreamAttachmentService` detaches only if no transport
or overlay owner remains. Main keeps streaming and other windows keep observing.

### Defensive routing

A chunk without `executionId` or `attemptId` is unexpected — Main always tags
chat chunks. It is dropped with a warning rather than guessed onto a branch.

## useExecutionOverlay

`src/renderer/hooks/useExecutionOverlay.ts`. The per-execution
overlay, built on `ExecutionStreamOverlayService` +
`TopicStreamSubscription`.

```ts
const { overlay, liveAssistants, disposeOverlay, reset, clear } = useExecutionOverlay(
  topicId,
  activeExecutions,      // ActiveExecution[] from useTopicStreamStatus
  uiMessages,            // current DB snapshot
  { onFinish }
)
```

The hook is a thin React binding for the window-level
`ExecutionStreamOverlayService`, which owns readers, snapshots and
rAF batching keyed by `topicId`. The hook only acquires/releases a
refcounted view and reads it via `useSyncExternalStore` — unmounting
(route/tab/conversation switch) does **not** tear the stream down,
and remounting restores the live overlay synchronously.

### One reader per turn, zero cross-turn state

Each execution gets a **one-shot `readUIMessageStream` reader** per
turn, not a stateful AI SDK `Chat`. A `Chat` carries
`state.messages` across turns; reusing it made a new turn resume from
the previous turn's finished assistant ("previous answer + new
stream"). A fresh reader per turn structurally cannot pollute.

### The seed rule (continue-safe)

```ts
function pickSeed(uiMessages, anchorMessageId): CherryUIMessage | undefined {
  if (!anchorMessageId) return undefined
  const found = uiMessages.find((m) => m.id === anchorMessageId)
  if (!found) return { id: anchorMessageId, role: 'assistant', parts: [] }
  // `readUIMessageStream` mutates `message.parts` in place, and `found` is the live
  // SWR-derived row — clone the parts so the reader only ever writes to a throwaway.
  return { ...found, parts: structuredClone(found.parts ?? []) }
}
```

The reader is seeded with the message whose id is the execution's
`anchorMessageId`, taken from the **current DB truth** at reader-start
time. Two cases:

- **Fresh placeholder** — the SQLite row has empty parts; the seed is
  effectively empty and the reader builds the message from scratch.
- **Tool-approval / continue-conversation** — the row already carries
  the prior assistant parts (including the unresolved `tool-input` part
  the approval was on). A streamed `tool-output` chunk then merges
  cleanly onto its matching `tool-input` because they share the same
  `toolCallId`.

The seed is re-derived from DB on every reader start; it never carries
across turns, and its `parts` are cloned so the reader's in-place mutation
never touches the SWR row. Combined with the fresh reader, this is the
**structural** anti-pollution guarantee — not "force empty parts" or "diff
against last frame".

### Lifecycle (light cache, DB is the source of truth)

The overlay is a **temporary stash of in-flight streamed content**;
SQLite is authoritative. Losing the stash costs at most one DB
refresh on the next mount, which bounds how much machinery it earns.

1. **`activeExecutions` change** — converge the mounted consumers' desired
   executions with the current reader map; newly-active attempts get a fresh
   seeded reader, while finalizing attempts stay attached until their terminal
   fence arrives.
2. **Terminal** — the branch is closed by `TopicStreamSubscription`;
   the reader's `for await` exits. The `onFinish(executionId, event)`
   callback fires with the final snapshot + `{ isAbort, isError }`.
3. **Topic quiescence** — the service records Main's attempt watermark,
   calls the latest mounted DB refresh port, and only after that refresh
   succeeds calls `retireThrough(watermark)`.
4. **Unmount / tab switch** — the view and its refresh port are released,
   but running readers keep assembling in the service. A pending handoff is
   re-kicked when a refresh port mounts again.

Destruction policy:

| Situation | What happens |
|---|---|
| Stream running | Entry retained regardless of mounts |
| Topic quiesces, view mounted | Service-owned handoff runs `refresh()`; success retires every record through the durable attempt watermark |
| DB refresh fails | Final overlay remains visible and the service retries with backoff; a later mounted refresh port can re-kick the handoff |
| Stream ends, no view | That execution's overlay is dropped immediately (the persisted DB row owns it); the entry drops once its last reader ends and Main confirms the topic is done. `isTopicDone=false` keeps only the topic attachment across the continuation gap; queued continuation chunks then pin it until they are read or their round terminates |
| Leak backstop | `MAX_ENTRIES` LRU eviction of refCount-0 entries (readers cancelled first) |

Four guards keep the lifecycle race-free without any turn-identity
machinery:

- **The durable watermark, not reader liveness, scopes terminal retirement.**
  `retireThrough()` deliberately cancels and unregisters every covered reader
  and removes the same covered attempts from snapshots, settlements, optimistic
  projections, seeds, and reader-version indices. A newer attempt has a larger
  id and survives an older handoff. The destructive full drop remains a separate
  `clear()` operation (quick-assistant).
- **A failed `ai.stream.attach` error-terminates its branches** so
  readers finish instead of hanging forever; the next mount re-attaches
  through a fresh subscription.
- **`isTopicDone=false` retains the topic attachment across continuation
  gaps.** An execution terminal is not permission to detach when Main has
  explicitly kept the topic alive and has not scheduled the next branch yet.
- **A finished attempt is fenced** by `TopicStreamProjection`, so a
  remount whose Activity-preserved consumer state still lists it cannot
  restart it into a zombie reader. Exact settlements are compacted once the
  monotonic topic watermark covers them; the watermark remains the fence
  without retaining per-attempt tombstones indefinitely.

### Overlay teardown is monotonic

The overlay service owns the quiesce → DB refresh → retirement transaction.
The chat hook only registers a refresh port; it does not sequence disposal.
Each handoff captures Main's monotonic attempt watermark. After a successful
refresh, `retireThrough(watermark)` removes all covered overlay state in one
pass and leaves newer attempts untouched. If a newer watermark arrives while
the refresh is in flight, the service immediately runs another handoff.

A failed refresh never drops the final overlay. The service exposes the error,
retains the handoff, and retries with backoff. This ordering eliminates the
visible gap between streamed content and persisted parts: SWR has the
authoritative row before covered overlay records disappear.

The renderer never writes streamed parts to SWR — writing them would
race the DB-authoritative refresh and cause flicker.

### Why retained snapshots after terminal

The service keeps a final snapshot until one of:

- a successful service-owned handoff retires its attempt watermark,
- an explicit `disposeOverlay(messageId)` / `reset()` retires it, or
- `clear()` performs the destructive quick-assistant reset,
- the entry is dropped (last reader ended at refCount 0, or eviction).

That retention lets consumers read the final frame for the brief window
between stream-end and DB-refresh-complete without going through SWR.

## Code map

```
src/renderer/services/aiTransport/StreamAttachmentService.ts       ← per-window/topic lease owner; sole detach caller
src/renderer/services/aiTransport/TopicStreamSubscription.ts       ← attachment lease + branch demux (one per retained topic)
src/renderer/services/aiTransport/ExecutionStreamOverlayService.ts ← window-level readers/snapshots/rAF, keyed by topicId
src/renderer/hooks/useExecutionOverlay.ts                          ← React binding (refcounted view lease)
src/renderer/pages/home/useChatRuntimeState.ts                     ← persistent consumer + DB refresh port
```

## Invariants reviewers should check

1. **Same merge function on both sides.** Any code that re-implements
   chunk → message assembly on the renderer (instead of feeding
   `readUIMessageStream`) is wrong — that's where Main and renderer
   will diverge first.
2. **One reader per branch identity.** No reader should be reused
   across `activeExecutions` transitions where either `executionId` or
   `anchorMessageId` changes. Reusing one is what the v1 `Chat` bug
   was; keying only by model id reintroduces the same problem for
   same-model steer continuations.
3. **Seed from current DB.** `pickSeed` reads `uiMessagesRef.current`
   at reader-start time. Stashing the seed on first mount and reusing
   it across turns would defeat the continue-conversation case.
4. **Handoff is refresh-before-retire.** Quiescence must enter the service-owned
   handoff; only a successful refresh may call `retireThrough(watermark)`, while
   refresh failure retains the final overlay for retry.
5. **`TopicStreamSubscription` never aborts.** It only detaches.
   Anything in this layer that calls `ai.stream.abort` is in the
   wrong place — abort belongs to `useChatWithHistory.stop`.
6. **Window-level attachment ownership.** Releasing an
   `IpcChatTransport` stream must NOT detach while a
   `TopicStreamSubscription` still owns the topic, and vice versa. Only
   `StreamAttachmentService` may send `Ai_Stream_Detach` for the final lease.

## Where to read more

- Main-side accumulator: [Stream Manager — `pipeStreamLoop`](./stream-manager.md#execution-loop--runexecutionloop--pipestreamloop)
- IPC envelope: [IPC Transport](./ipc-transport.md)
- Topic status / approval-anchor surfacing: [Tool Approval](./tool-approval.md)
- AI SDK upstream: [`readUIMessageStream` reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/read-ui-message-stream)
