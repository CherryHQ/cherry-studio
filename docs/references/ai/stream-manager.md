# AiStreamManager

## What it is

`AiStreamManager` is the Main-process **active-stream registry** and the
broker for every stream event. It owns the full life cycle of an AI
streaming reply — from `sendMessages` until the assistant turn finishes
persisting — including multicast fan-out, reconnect, abort, steering
(queue + yield + continuation), and persistence triggering.

The renderer no longer holds a direct reference to the stream. Closing a
window does not abort the stream; it continues on Main and persists
normally. When the user returns, `attach` re-subscribes and the
manager replays any chunks that landed in between.

**Key: `topicId`.** A topic has at most one active stream at a time;
"streaming" is one phase of a topic, and every subscriber on a topic is
equal — there is no "owner" window.

## Why it exists

v1 ran the stream lifecycle, fan-out, and persistence on the **renderer**,
which produced three structural bug classes:

- **Window-bound lifecycle** — unmounting the chat (topic switch, window
  close, route change) cancelled the transport stream, which aborted the
  upstream request and dropped the in-flight reply.
- **No reconnect** — `reconnectToStream()` always returned `null`, so
  returning to a topic lost live progress until the row hit the DB.
- **Renderer-owned persistence** — the DB write lived in the renderer, so a
  crash/close between stream-end and commit lost the reply.

**Goal:** move stream lifecycle, multicast fan-out, and persistence to Main;
the renderer's only job is rendering chunks. The sections below are the
reference for that Main-side design.

## Architecture

```
┌──────────────── Renderer ────────────────────────────────────┐
│                                                              │
│  useChat({ id: topicId, transport: IpcChatTransport })       │
│    ├─ sendMessages   → Ai_Stream_Open  (topicId, trigger, userMessageParts, …)
│    ├─ reconnectToStream → Ai_Stream_Attach ({ topicId })     │
│    └─ abort signal   → Ai_Stream_Abort  ({ topicId })        │
│                                                              │
│  History:           useQuery('/topics/:id/messages')         │
│  Topic-level state: useTopicStreamStatus → shared cache       │
└──────────────────────────────────────────────────────────────┘
                 ↕ IPC (all keyed by topicId)
┌──────────────── Main ────────────────────────────────────────┐
│                                                              │
│  dispatchStreamRequest(manager, subscriber, req)             │
│    │ pick first ChatContextProvider whose canHandle matches  │
│    │ provider.prepareDispatch(subscriber, req, ctx)          │
│    └ manager.send(prepared)                                  │
│                                                              │
│  AiStreamManager                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ activeStreams: Map<topicId, ActiveStream>              │  │
│  │   listeners:  Map<listenerId, StreamListener>          │  │
│  │   executions: Map<modelId, StreamExecution>            │  │
│  │     ├─ abortController / status                        │  │
│  │     └─ buffer (ring) + droppedChunks                   │  │
│  │   lifecycle: StreamLifecycle  (chat or prompt)         │  │
│  └────────────────────────────────────────────────────────┘  │
│         ↓ createAndLaunchExecution → runExecutionLoop        │
│  AiService.streamText(request) → ReadableStream<UIMessageChunk> │
│         ↓ pipeStreamLoop (tees: broadcast + readUIMessageStream) │
│                                                              │
│  terminal → dispatchToListeners → every StreamListener:      │
│    WebContentsListener    → wc.send(Ai_StreamDone)           │
│    PersistenceListener    → PersistenceBackend.persistAssistant
│      • MessageServiceBackend  (SQLite tree)                  │
│      • TemporaryChatBackend   (in-memory)                    │
│      • AgentSessionMessageBackend (agent-session DB)         │
│      • TranslationBackend     (translate row)                │
│    TraceFlushListener    → TraceStorageService.saveSpans(topicId)
│    ChannelAdapterListener → adapter.onStreamComplete         │
│    SseListener            → res.write('[DONE]')              │
└──────────────────────────────────────────────────────────────┘
```

## Pub/sub model

The manager is a broker: one set of producers feeds it, one set of
consumers subscribes. The system uses the observer pattern, and splits
dispatch into two semantically distinct channels based on **payload
volume × audience width**.

### Producers

| Producer | Events | Source |
|---|---|---|
| `StreamExecution` loop | `UIMessageChunk` (per-chunk delta) | `AiService.streamText`'s `ReadableStream` |
| `AiStreamManager` (state machine) | topic-level status transitions | `send()` → `pending`, first chunk → `streaming`, three terminal handlers → `done` / `error` / `aborted`, `awaiting-approval` on `tool-approval-request` |

### Consumers

| Consumer | Events | Subscription |
|---|---|---|
| `WebContentsListener` | chunk + terminal | explicit `attach` → `ActiveStream.listeners` |
| `PersistenceListener` | terminal | built by the provider and added in `send()` |
| `TraceFlushListener` | terminal | built by chat / agent-session turn owners and added in `send()` |
| `ChannelAdapterListener` / `SseListener` | chunk + terminal | caller injects into `send()`'s `listeners` |
| UI indirect consumers (sidebar indicators, …) | topic status | `useSharedCache('topic.stream.statuses.${topicId}')` |

### Two channels: targeted listener dispatch vs SharedCache mirror

| | Targeted listener dispatch | SharedCache mirror |
|---|---|---|
| Transport | `Ai_StreamChunk` / `Ai_StreamDone` / `Ai_StreamError` | `cacheService.setShared('topic.stream.statuses.${topicId}', …)` → built-in `Cache_Sync` broadcast |
| Main-side registry | `ActiveStream.listeners: Map<listenerId, StreamListener>` | none — uses the generic `CacheService` infra |
| Subscriber API | `attach` to register, explicit `detach` | `useSharedCache('topic.stream.statuses.${topicId}')` by topicId |
| Per-event size | tens of bytes to KBs (10s/s) | tens of bytes (≤ 5 transitions per stream) |
| Audience | narrow (one window per listener typically) | wide (every sidebar / indicator across all windows) |
| Cost of irrelevant pushes | high (bandwidth + deserialization) | negligible |

### Channel selection rule

Choose by **consumer / producer fanout**:

- chunk stream: one execution produces it, only the window rendering
  that topic needs it → **targeted listener dispatch**, no irrelevant
  pushes.
- topic status: one transition, every UI mirror wants it → **SharedCache**,
  reuse generic cache sync, no bespoke IPC.

### Rules that follow from the channel split

- **`Ai_Stream_Attach` is required.** The listener channel requires
  explicit consumer registration; `attach` is the entry point and also
  returns a compact replay to fill the "before I subscribed" gap.
- **Bootstrap needs no extra IPC.** A new window pulls all shared cache
  entries via `Cache_GetAllShared` on mount; every
  `topic.stream.statuses.${topicId}` entry comes through without a
  bespoke snapshot IPC.
- **Snapshot vs delta race.** Handled by the shared cache sync layer
  itself — initial pull and `Cache_Sync` delta share the Main-side
  source of truth; late arrivals overwrite stale state.
- **Grace-period cleanup does NOT clear the SharedCache entry.** Terminal
  values (`done` / `aborted` / `error`) stay so renderer-side consumers
  (`useTopicDbRefreshOnTerminal`, `useChatWithHistory`, awaiting-approval
  indicators, sidebar badges) can observe them. The fulfilled-badge gate
  is a read-receipt: the entry's `lastCompletedAt` (bumped only on
  `done`) compared against `topic.stream.last_seen_completion.${topicId}`
  (cross-window shared cache, written when the user acknowledges).
  Memory tier — both reset on app restart.
- **`PersistenceListener` placement.** Terminal-only consumer — doesn't
  need chunk bandwidth → not added via `attach`; the provider includes
  it in the `listeners` array passed to `send()`.
- **`TraceFlushListener` placement.** Terminal-only consumer that flushes
  `TraceStorageService.saveSpans(topicId)` after a chat / agent turn completes.
  It belongs with the turn owner (`PersistentChatContextProvider` or
  `AgentSessionRuntimeService`), not inside `AiStreamManager` and not in
  trace viewer UI.

## File layout

```
src/main/ai/
├── AiService.ts                       lifecycle service: streamText + non-streaming IPC gateway
└── runtime/aiSdk/
    └── Agent.ts                       single-pass `Agent.stream` wrapper (see Agent Loop)

src/main/ai/streamManager/
├── AiStreamManager.ts                 the registry + execution loop + multicast
├── pipeStreamLoop.ts                  shared chunk-pipe primitive (used by AiStreamManager.runExecutionLoop)
├── buildCompactReplay.ts              attach-time chunk compaction (merge text-delta / reasoning-delta)
├── types.ts                           ActiveStream / StreamExecution / StreamListener / timings
├── index.ts                           barrel
│
├── context/                           per-topicId namespace dispatch
│   ├── ChatContextProvider.ts            interface + PreparedDispatch
│   ├── dispatch.ts                       single manager.send entry; MainContinueConversationRequest
│   ├── PersistentChatContextProvider.ts  uuid topics → SQLite tree
│   ├── TemporaryChatContextProvider.ts   in-memory (TemporaryChatService)
│   ├── AgentChatContextProvider.ts       `agent-session:` → agents DB
│   └── modelResolution.ts                resolveModels / siblingsGroupId
│
├── lifecycle/                         strategy: chat vs ad-hoc prompt
│   ├── StreamLifecycle.ts             interface
│   ├── ChatStreamLifecycle.ts         cross-window broadcast + 30 s grace period + attach
│   └── PromptStreamLifecycle.ts       silent, no attach, immediate eviction
│
├── listeners/
│   ├── WebContentsListener.ts         chunks → renderer windows
│   ├── PersistenceListener.ts         observer protocol + delegates to PersistenceBackend
│   ├── TraceFlushListener.ts          terminal trace-cache flush to local history
│   ├── ChannelAdapterListener.ts      text → Discord / Slack / Feishu
│   └── SseListener.ts                 UIMessageChunk → SSE response (API server)
│
└── persistence/
    ├── PersistenceBackend.ts          strategy interface + statsFromTerminal projection
    └── backends/
        ├── MessageServiceBackend.ts   finalize a SQLite pending placeholder
        ├── TemporaryChatBackend.ts    append to in-memory topic
        └── TranslationBackend.ts      attach `data-translation` part to a target message
```

Agent session persistence is implemented under `agentSession/persistence`
because it writes the agent-session domain tables.

## StreamListener interface

The manager treats every consumer through one interface; it dispatches
each event by calling these methods uniformly:

```typescript
interface StreamListener {
  readonly id: string
  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId, anchorMessageId?: string): void
  onDone(result: StreamDoneResult): void | Promise<void>      // { finalMessage?, status: 'success', ... }
  onPaused(result: StreamPausedResult): void | Promise<void>  // { finalMessage?, status: 'paused',  ... }
  onError(result: StreamErrorResult): void | Promise<void>    // { finalMessage?, error, status: 'error', ... }
  isAlive(): boolean
}
```

All three terminal shapes share the same `finalMessage?` field — the
`UIMessage` accumulated by `readUIMessageStream` in the execution loop.
Whether the stream ended naturally, was aborted, or errored, it's the
same variable, only the stop point differs. Earlier designs called the
error-path partial a `partialMessage`; this turned out to be just a
`finalMessage` that ended early. Unifying the shape means
`PersistenceBackend` needs one `persistAssistant` method, not separate
write paths per status.

Renderer-facing listeners also receive `anchorMessageId`, the assistant
row the execution writes to. This is part of the stream branch identity:
`sourceModelId` distinguishes parallel model executions, while
`anchorMessageId` distinguishes same-model chained turns such as steer
continuations.

### Built-in implementations

| Listener | Role | id | isAlive |
|---|---|---|---|
| **WebContentsListener** | chunks → renderer window | `wc:${wc.id}:${topicId}` | `!wc.isDestroyed()` |
| **PersistenceListener** | terminal write via strategy | `persistence:${backendKind}:${topicId}:${modelId ?? 'default'}` | always `true` |
| **TraceFlushListener** | terminal trace-cache flush | `persistence:trace:${topicId}` | always `true` |
| **ChannelAdapterListener** | text → IM platform | `channel:${channelId}:${chatId}` | `adapter.connected` |
| **SseListener** | API-server SSE passthrough | `sse:${uuid}` | `!res.writableEnded` |

### Unified liveness policy

`AiStreamManager.dispatchToListeners` is the single funnel for terminal
events (`onDone` / `onPaused` / `onError`). Per listener it:

- Calls `listener.isAlive()` before each broadcast — `false` removes the
  listener from `stream.listeners` (cleans up dead consumers).
- Wraps each call in try/catch — one bad listener can't starve the rest.
- Logs by event name + listener id for easy triage.

`onChunk` keeps a synchronous contract (the execution loop can't `await`
a listener) so it inlines the loop instead of going through
`dispatchToListeners`, but the dead-listener cleanup is the same.

### PersistenceListener — strategy pattern

One listener + four backends:

```typescript
interface PersistenceBackend {
  readonly kind: string   // "sqlite" | "temp" | "agents-db" | "translation"
  persistAssistant(input: {
    finalMessage?: CherryUIMessage
    status: 'success' | 'paused' | 'error'
    modelId?: UniqueModelId
    stats?: MessageStats
  }): Promise<void>
  afterPersist?(finalMessage: CherryUIMessage): Promise<void>
}
```

Backends expose **one** write method; the three statuses share its
shape. On the `error` branch, `PersistenceListener` folds the
`SerializedError` into a trailing `data-error` part on `finalMessage.parts`
and then calls `persistAssistant({ status: 'error' })`, so backends never
have to know how to encode an error into a UIMessage — they just write.

The listener owns the observer protocol: filter by `modelId`
(multi-model topics have one listener per execution), merge the error
part exactly once, swallow exceptions so they don't break downstream
dispatch, fire `afterPersist` only when `status === 'success'` and
`finalMessage` is present (best-effort). Adding a fifth storage path
(e.g. an outbox) is a 60-line backend, no listener boilerplate to copy.

## ActiveStream & StreamExecution

```typescript
interface ActiveStream {
  topicId: string
  executions: Map<UniqueModelId, StreamExecution>   // 1 entry single-model, N multi-model
  listeners: Map<string, StreamListener>            // shared across executions
  // 'pending' on creation; flips to 'streaming' on first chunk; derived
  // from executions on terminal (done / aborted / error /
  // awaiting-approval).
  status: TopicStreamStatus
  isMultiModel: boolean                             // fixed at create; tags onChunk's sourceModelId
  lifecycle: StreamLifecycle                        // chat or prompt strategy
  expiresAt?: number
  cleanupTimer?: ReturnType<typeof setTimeout>
}

interface StreamExecution {
  modelId: UniqueModelId
  anchorMessageId?: string  // placeholder id for submit/regen, anchor id for continue
  abortController: AbortController
  status: 'streaming' | 'done' | 'error' | 'aborted'

  // Per-execution ring buffer for reconnect replay. Hitting
  // `maxBufferChunks` drops the oldest entry and bumps `droppedChunks`.
  // Independent buffers prevent a chatty model from evicting a slower
  // model's replay (a shared buffer would).
  buffer: StreamChunkPayload[]
  droppedChunks: number

  finalMessage?: CherryUIMessage

  // Set the moment a `tool-approval-request` chunk arrives, cleared on
  // response. Read by `resolveTerminalStatus` to surface
  // `awaiting-approval` on the topic.
  awaitingApproval?: boolean

  error?: SerializedError
  siblingsGroupId?: number
  loopPromise: Promise<void>     // awaited by onStop for graceful shutdown

  // Transport-side timings owned by the execution loop — chunk-shape-agnostic.
  // Semantic timings (firstTextAt / reasoning*) live on the listener
  // that cares; see "Stats composition" below.
  timings: TransportTimings

  // OTel root span set as active context around runExecutionLoop so
  // AI SDK spans become children. Created by the context provider.
  rootSpan?: Span
}

interface TransportTimings {
  readonly startedAt: number   // execution loop entry
  completedAt?: number         // execution loop exit (both try and catch paths)
}

interface SemanticTimings {
  firstTextAt?: number           // first text-delta chunk (TTFT endpoint)
  reasoningStartedAt?: number    // first reasoning-* chunk
  reasoningEndedAt?: number      // first non-reasoning chunk after reasoning
}
```

Topic-level status is derived from executions, with `'pending'` as the
initial pre-first-chunk window:

- Created (`send()` returned) → `'pending'`
- Any execution emits its first chunk → `'streaming'`
- All terminal, all `done` → `'done'`
- All terminal, all `aborted` → `'aborted'`
- Has `error`, none `streaming` → `'error'`
- Any execution still has `awaitingApproval` true on a terminal topic → `'awaiting-approval'`

`pending → streaming` is a one-time transition (first chunk anywhere).
The terminal status is derived once when the last execution terminates.

### Stats composition — tokens + timings → MessageStats

**Ownership** (key invariant: manager does not peek at chunk payloads):

| Source field | Owner | Collected at |
|---|---|---|
| `TransportTimings.startedAt` | `AiStreamManager` | `createAndLaunchExecution` |
| `TransportTimings.completedAt` | `AiStreamManager` | `pipeStreamLoop`'s `broadcastCompletedAt` |
| `SemanticTimings.firstTextAt` | `PersistenceListener` | own `onChunk`, first `text-delta` |
| `SemanticTimings.reasoning*` | `PersistenceListener` | own `onChunk`, observing `reasoning-*` boundaries |
| Token metadata | `agentLoop` usage observer | `finish` chunk projects AI SDK `LanguageModelUsage` → `CherryUIMessageMetadata` |

The manager is chunk-shape-agnostic — multicast, reconnect, abort,
steer queue/continuation, persistence-triggering, never "what is text /
what is reasoning". AI SDK chunk type changes (vNext renames) only touch
`PersistenceListener`; the manager stays stable.

**Final projection.** The listener first terminalizes interrupted parts so
their stabilized reasoning duration is available, then calls
`statsFromTerminal(finalMessage, mergedTimings)`. It merges its
`SemanticTimings` with `result.timings` (transport) before calling it:

```typescript
// inside PersistenceListener
const parts = finalizeInterruptedParts(finalMessage.parts, status)
const finalMessageForPersistence = { ...finalMessage, parts }
const mergedTimings = { ...result.timings, ...this.semanticTimings }
const stats = statsFromTerminal(finalMessageForPersistence, mergedTimings)
await this.opts.backend.persistAssistant({ finalMessage: finalMessageForPersistence, status, modelId, stats })
```

Projected `MessageStats` fields:

| Field | Source |
|---|---|
| `totalTokens / promptTokens / completionTokens / thoughtsTokens` | `finalMessage.metadata.*` |
| `timeFirstTokenMs` | `round(firstTextAt - startedAt)` |
| `timeCompletionMs` | `round(completedAt - startedAt)` |
| `timeThinkingMs` | Sum of stabilized `providerMetadata.cherry.thinkingMs` values from persisted reasoning parts; does not use the reasoning wall-clock, which can include interleaved tool execution |

Backends never terminalize parts or derive stats themselves; they write the
listener-normalized `finalMessage` and `input.stats`. One projection path, four
backends, no duplication.

## Public API

```typescript
class AiStreamManager {
  // Lifecycle container invokes with no args (DEFAULT_CONFIG); tests can
  // override `gracePeriodMs`, `backgroundMode`, `maxBufferChunks`.
  constructor(config?: Partial<AiStreamManagerConfig>)

  readonly chatLifecycle: StreamLifecycle

  // ── Single dispatch entry ─────────────────────────────────────────
  // Live topic → inject (upsert listeners onto the running stream, models
  // ignored — reached by chat steers and agent-session follow-ups whose user
  // row was already persisted/enqueued by their provider). Otherwise → start
  // (evict any grace-period stream, launch one execution per `models` entry).
  // Multi-model is detected from `models.length > 1`.
  send(input: SendInput): SendResult

  // ── Ad-hoc prompt stream (translate / topic-naming / model probes)
  // Bypasses the chat dispatcher; uses promptStreamLifecycle (silent, no
  // attach, immediate eviction).
  streamPrompt(input: {
    streamId: string                                       // doubles as topicId
    uniqueModelId: UniqueModelId
    prompt?: string
    messages?: CherryUIMessage[]
    listener: StreamListener | StreamListener[]
  }): SendResult

  // ── Subscription management ───────────────────────────────────────
  attach(sender: WebContents, req: { topicId }): AiStreamAttachResponse
  detach(sender: WebContents, req: { topicId }): void
  addListener(topicId: string, listener: StreamListener): boolean
  removeListener(topicId: string, listenerId: string): void

  // ── Control ───────────────────────────────────────────────────────
  abort(topicId: string, reason: string): void
  hasLiveStream(topicId: string): boolean
  // Queue a steer user row persisted while a turn was live; the running turn
  // yields and `onExecutionDone` chains a `steer-continuation` to answer it.
  enqueuePendingSteer(topicId: string, userMessageId: string): void
  hasPendingSteer(topicId: string): boolean

  // ── Execution-loop callbacks (driven internally; public for tests) ─
  onChunk(topicId, modelId, chunk): void
  onExecutionDone(topicId, modelId): Promise<void>
  onExecutionPaused(topicId, modelId): Promise<void>
  onExecutionError(topicId, modelId, error): Promise<void>

  // ── Inspection (read-only snapshot) ───────────────────────────────
  inspect(topicId: string): TopicSnapshot | undefined

  // ── Write quiesce (backup restore) — see the dedicated section ────
  get isWriteQuiesced(): boolean
  pause(reason?: string): Disposable
  drainInFlight(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }>
  listActiveWork(): Array<{ id: string; summary: string }>
}
```

### `send` contract

```typescript
interface SendInput {
  topicId: string
  models: ReadonlyArray<{ modelId: UniqueModelId; request: AiStreamRequest; rootSpan?: Span }>
  listeners: StreamListener[]
  siblingsGroupId?: number
  lifecycle?: StreamLifecycle        // omit → chatLifecycle; streamPrompt passes promptStreamLifecycle
}

interface SendResult {
  mode: 'started' | 'injected'
  executionIds: UniqueModelId[]      // started → fresh ids; injected → already running
}
```

- **injected**: topic has a live stream (`pending` or `streaming`) →
  `models` is ignored and `listeners` upsert by id; **no models are
  launched**. Reached by (a) a chat steer — the provider already persisted the
  steer user row and `dispatch` enqueued it on `pendingSteers`; and (b) an
  agent-session follow-up already enqueued on the session's `pendingTurns`. An
  empty-`models` send with no live stream is likewise a no-op (the row is
  already enqueued) — `send()` never throws on empty models.
- **started**: topic is idle or grace-period (terminal) → any leftover
  grace-period stream is evicted, a new `ActiveStream` is created with
  `isMultiModel = models.length > 1`, one execution launched per model.

`isMultiModel` is not an input — it's derived from `models.length`.

### Execution loop — `runExecutionLoop` + `pipeStreamLoop`

Each execution runs an independent loop that bridges "the single
`ReadableStream` from AI SDK" to "what the manager has to do":
broadcast to listeners, buffer for reconnect, and accumulate a
persistable `finalMessage`.

**Step 1 — get the raw chunk stream.**

```typescript
const stream: ReadableStream<UIMessageChunk> = await aiService.streamText({
  ...request,
  requestOptions: { ...request.requestOptions, signal }
})
```

`streamText` returns AI SDK's raw chunk stream. `signal` comes from
`StreamExecution.abortController`; `abort()` triggers it.

**Step 2 — wrap with `withIdleTimeout`.** Resets per chunk; on idle
timeout it aborts `exec.abortController`, which the upstream request is
already wired to.

**Step 3 — `pipeStreamLoop` tees the chunk stream.**

`pipeStreamLoop` is the shared chunk-pipe primitive (the one
`AiStreamManager.runExecutionLoop` uses). It `tee()`s the stream into two
independent branches:

| Branch | Consumer | Purpose |
|---|---|---|
| Broadcast | `onChunk(topicId, modelId, chunk)` per chunk | Buffer into `exec.buffer` (ring), fan out to every listener |
| Accumulator | `readUIMessageStream` | Each yielded snapshot is written to `exec.finalMessage`; at stream end it's the final message |

The accumulator reader is **not** cancelled directly on abort —
`Agent.stream` honours the same signal upstream and propagates `done`
through `tee()`, so the accumulator drains naturally. Cancelling the
accumulator reader directly would race AI SDK's internal
`controller.close()` and produce an `ERR_INVALID_STATE`
unhandledRejection.

**Step 4 — terminal dispatch.**

| Exit path | Handler | Behaviour |
|---|---|---|
| Normal end | `onExecutionDone` | `exec.status = 'done'`, finalMessage persisted as `success` |
| `signal.aborted` + `exec.status === 'aborted'` | `onExecutionPaused` | (Possibly partial) finalMessage persisted as `paused` |
| `streamErrorText` (in-stream `error` chunk) | `onExecutionError` | Error part folded into finalMessage, persisted as `error` |
| Pre-stream or broadcast throw | `onExecutionError` | Same — error part folded, persisted |

## Write quiesce (pause / drainInFlight)

Serves backup restore (#16849, same contract as JobManager's — see
[job overview](../job-and-scheduler/overview.md#pause-and-drain-write-quiesce)): after
the restore snapshot is staged, any main-side write to the old live DB fails the
fingerprint re-check and wastes the whole restore attempt. Three AI-side writers carry
the contract — `AiStreamManager`, `AgentSessionRuntimeService`, and channel intake
(`ChannelManager` → `ChannelMessageHandler`) — each exposing
`pause(reason?): Disposable` + `drainInFlight({ timeoutMs }) → { stragglerIds }`
(empty = clean) + an advisory read-only `listActiveWork()`.

Orchestration order (grandfather-free, per #16850) — the channel step MUST fully complete
before the AI writers are paused:

1. `ChannelManager.pause()` — gate new adapter messages/commands and immediately flush the
   buffered debounce batches (never cancel: adapters ack at the transport layer on receipt,
   so the in-memory buffer is the only copy).
2. `await ChannelManager.drainInFlight()` — flush only *schedules* each batch's admission (its
   `processIncoming` runs on the per-chat queue microtask), so `pause()` returning does NOT
   mean the batches admitted. This await is the flush-to-admission barrier: it resolves once
   every flushed batch passed agent-turn *admission* (not turn completion — the flushed turns
   land in the AI in-flight set, covered from there by the AI drains).
3. **only then** pause AI + JobManager (any order) → joint drain → verdict → snapshot.

Why the barrier is load-bearing: if the AI writers are paused while a flushed batch is still
between flush and `startAgentSessionRun`, the batch hits the closed AI gate and is rejected.
Because the adapter already ACKed it, it cannot be recovered by aborting the restore. The
channel-drain-before-AI-pause ordering is therefore a correctness precondition, not merely a
performance optimization. On any drain timeout the orchestrator aborts the attempt (dispose
all holds); the happy path never disposes — the holds stand until relaunch, and a lost hold
fails closed.

AiStreamManager specifics:

| Rule | Detail |
|---|---|
| Gate = dispatch admission | Checked inside the `withDispatchLock` callback (post-mutex re-check), BEFORE `prepareDispatch` writes the user/pending-assistant rows. `dispatch()` returns `{ mode: 'blocked', reason: 'paused' }`; `startAgentSessionRun` throws. Unlike JobManager, the AI gate rejects by design — a new turn is an execution start, not data at rest. |
| Steer continuations suppressed, not rejected | `startNextChatTurn` returns before consuming the steer queue and records the topic; the last hold's disposal re-kicks it. The `steer-continuation` trigger is exempt from the `dispatch()` gate (it only originates from the gated `startNextChatTurn`; a grandfathered launch is drained via `inFlightChatContinuations`). |
| Not gated | `send()` / `startRuntimeTurn()` (a continuation past its upstream gate must reach them), `streamPrompt()` (renderer-driven callers are covered by the restore UI block; chunks-only prompt streams write nothing), and `AiService.embedMany` (never routes through this manager) — knowledge indexing keeps working while quiesced. |
| Drain wait-set | Executions of streams carrying a `persistence:*` listener — listener-derived, not lifecycle-derived: chunks-only prompt streams (API gateway, orphan translate) are excluded, while a translate-with-persist carries a `TranslationBackend` persistence listener and IS drained. Plus in-flight steer-continuation launches and `TopicNamingService.inFlightWrites()` — the summary renames are spawned detached (`void backend.afterPersist(...)`), so a loopPromise settles before their DB write lands; the registry closes that gap. The set can grow one step while draining (a settling loop spawns a naming write; a grandfathered continuation opens a stream), so the drain is a fixed point over promise identities, bounded by `timeoutMs`. |
| Timeout | Never rejects; stragglers are not aborted (the orchestrator decides — see the job overview for why an abort would poison the snapshot). |

`AgentSessionRuntimeService` gates its two autonomous turn starters (`startNextTurn` /
`startContinuationTurn`) before they consume queue/roll state or write the assistant
placeholder — suppressed starts stay queued (`isSessionBusy` holds) and are re-kicked on
release; its drain awaits `inFlightTurnStarts` (a launch admitted pre-pause through its
placeholder write + `startRuntimeTurn` handoff). See
[agent-session-runtime.md](./agent-session-runtime.md#write-quiesce).

## Lifecycle strategy — chat vs prompt

The manager stays policy-free. Behaviour that differs between chat
streams and one-shot ad-hoc prompts (translate, topic-naming, model
probes) lives in `StreamLifecycle`:

```typescript
interface StreamLifecycle {
  readonly name: string
  onCreated(stream): void                         // freshly registered
  onPromotedToStreaming(stream): void             // first chunk
  onTerminal(stream): void                        // every isTopicDone
  canAttach(stream): boolean                      // gate for `attach`
  cleanup(stream, evict: () => void): void        // when to remove from activeStreams
}
```

| | `ChatStreamLifecycle` | `PromptStreamLifecycle` |
|---|---|---|
| Status broadcast | writes `topic.stream.statuses.<topicId>` on `pending → streaming → terminal` (with `awaitingApprovalAnchors` derived from `exec.awaitingApproval`) | none |
| `canAttach` | `true` | `false` |
| `cleanup` | sets a `setTimeout(evict, gracePeriodMs)`; chat reconnects within 30 s | calls `evict()` immediately |

`send()` defaults to `chatLifecycle`; `streamPrompt()` passes
`promptStreamLifecycle`.

## Multi-model

User mentions multiple models for one turn:

```
User: "Explain quantum mechanics" @gpt-4o @claude-sonnet
                                ↓
PersistentChatContextProvider.prepareDispatch
    ├─ persist user message (tree node)
    ├─ resolveModels → [gpt-4o, claude-sonnet]
    ├─ siblingsGroupId = (monotonic counter)
    ├─ create one pending assistant placeholder per model (SQLite)
    ├─ build listeners: subscriber + 2 PersistenceListener (one per backend)
    ├─ build models: 2 × { modelId, request, rootSpan }
    └─ return PreparedDispatch

dispatchStreamRequest → manager.send({ models, listeners, siblingsGroupId })
                          │
                          ├─ create ActiveStream (isMultiModel = true, 2 executions)
                          ├─ launch one execution loop per model, each with its own
                          │  ring buffer
                          └─ return { mode: 'started', executionIds: [gpt-4o, claude-sonnet] }
```

## Steering

Steering a chat turn is **enqueue + yield + chain**, not abort-and-restart and
not mid-turn injection. When a new `Ai_Stream_Open` arrives for a chat topic that
is still streaming:

1. `PersistentChatContextProvider` (its `hasLiveStream` branch) persists the
   steer message as a normal user row and returns an enqueue-only
   `PreparedDispatch` — no models, `pendingSteerUserMessageId` set.
2. `dispatchStreamRequest` calls `manager.enqueuePendingSteer(topicId, id)`,
   pushing the row onto the topic's `pendingSteers` FIFO, then `send()` — which,
   seeing the live stream, just upserts the subscriber (inject).
3. The running turn's `steerYield` stop condition (OR'd into `stopWhen`) sees
   `hasPendingSteer` and stops the turn cleanly at the next step boundary
   (persisted as **`success`**, not `paused`).
4. `onExecutionDone` sees the queued steer and, instead of finalizing the topic,
   chains a `steer-continuation` dispatch (`startNextChatTurn`) that answers the
   head of the queue, carrying the prior turn's renderer listeners forward. The
   FIFO drains one continuation per completed turn.

**Drop-on-abort:** a steer chains only after a clean `done`. If the turn is
aborted (Stop) or errors, the queue is dropped and its persisted user rows stay
in history as dangling messages the user can resend (`onExecutionPaused` /
`onExecutionError` clear `pendingSteers`; a late steer landing after a non-clean
terminal is dropped by `enqueuePendingSteer`). A steer queued while a turn ends
`awaiting-approval` does **not** chain until the approval's `continue-conversation`
turn completes — chaining earlier would let the approval response be swallowed by
the inject branch. If the continuation itself fails to launch, the topic is driven
to a terminal `error` rather than sticking at `streaming`.

Agent-session topics use a parallel, queue-based mechanism — never an interrupt.
A live follow-up is steered into the running turn via `connection.redirect()`
(no abort); if there is no live turn, or the steer is never injected, it is
enqueued on the session's `pendingTurns` for the next turn. `send()` only upserts
the new subscriber. See
[Agent Session Runtime → Live follow-up](./agent-session-runtime.md#live-follow-up).

## End-to-end flows

One row per flow. The two with dedicated docs are cross-linked rather than
duplicated; the rest are stream-manager-specific.

| Flow | Trigger | Mechanism | Terminal / result |
|---|---|---|---|
| Submit (standard) | `Ai_Stream_Open` | `dispatchStreamRequest` → `prepareDispatch` (persist user msg, reserve placeholders, build listeners + models) → `manager.send` → N × `runExecutionLoop` | `Ai_StreamDone`; `PersistenceListener.persistAssistant`; chat lifecycle `scheduleCleanup(30 s)` |
| Steering — chat resubmit | `Ai_Stream_Open` on a live chat topic | provider persists the steer user row + `enqueuePendingSteer` → `pendingSteers`; `steerYield` stops the running turn cleanly; `onExecutionDone` chains a `steer-continuation` | prior turn persisted as **`success`**; the continuation answers the steer — see [Steering](#steering) |
| Agent-session follow-up | `Ai_Stream_Open` on a live `agent-session:*` topic | provider persists the user row, `enqueueUserMessage` steers via `connection.redirect()` (no abort) or queues on `pendingTurns`; `manager.send` upserts the subscriber → `{ mode: 'injected' }` | steer folds into the current turn (rolled at a `steer-boundary`), else the next turn starts from `pendingTurns` — see [Agent Session Runtime](./agent-session-runtime.md#live-follow-up) |
| Tool-approval pause+resume | approval-request chunk → `awaiting-approval` | decision via `Ai_ToolApproval_Respond`; Claude-Agent unblocks `canUseTool`, MCP dispatches `continue-conversation` | card clears when the resumed stream broadcasts `pending` — see [Tool Approval](./tool-approval.md) |
| Reconnect | `Ai_Stream_Attach` on mount | `manager.attach`: `not-found` / streaming (register listener + compact replay) / done-paused (`finalMessage(s)`) / error | live chunks resume, or the final row is returned |
| Abort — user stop | `Ai_Stream_Abort` | per exec: `abortController.abort` → loop `signal` aborts → broadcast reader `cancel` → read loop `done` | partial persisted as **`paused`**; topic status → `aborted` (or `awaiting-approval` if an exec had it set) |
| Abort — no subscribers | last `WebContentsListener` dies + `backgroundMode === 'abort'` | `onChunk` prunes dead listeners; `listeners.size === 0` → auto `abort(topicId, 'no-subscribers')` | partial persisted as **`paused`** — never silently `success` or leaked |
| Multi-window | window B opens a live topic | B sends `Ai_Stream_Attach` → compact replay + its own `WebContentsListener`; each chunk fans out to A and B | both windows render the same chunks in sync |
| Channel / Agent | `AiStreamManager.send` in-process (no IPC) | scenario differs only by listener composition (table below) | per-listener effect |

**Topic status needs no `attach`.** Observers that only care "is this topic
live?" (sidebar loading indicators, topic-list status dots) don't register a
`WebContentsListener`. Every status transition writes the SharedCache key
`topic.stream.statuses.${topicId}`; observers read it via `useSharedCache`
directly. `Ai_Stream_Attach` is only needed when a window wants live chunks.

### Channel / Agent listener composition

Channel adapters and the agent scheduler call `AiStreamManager.send`
directly inside Main — no IPC. The scenario differences are entirely in the
listener composition:

| Scenario | Listeners | Effect |
|---|---|---|
| Renderer user message | `WebContentsListener` + `PersistenceListener` | live UI + persist |
| Channel bot reply | `ChannelAdapterListener` + agent-session persistence listener | IM send + agents DB |
| Channel + user both watching | above + `WebContentsListener(B)` | parallel fan-out |
| API server SSE | `SseListener` + `PersistenceListener` | SSE push + persist |
| Translate | `WebContentsListener` + `PersistenceListener(TranslationBackend)` | live overlay + writes `data-translation` part on success |

## IPC contract

### Request channels (Renderer → Main)

| Channel | Payload | Response | Semantics |
|---|---|---|---|
| `Ai_Stream_Open` | `AiStreamOpenRequest` (`submit-message` \| `regenerate-message`) | `{ mode, executionIds?, userMessageId?, placeholderIds? }` | Open / inject; provider routes by topicId |
| `Ai_Stream_Attach` | `{ topicId }` | `AiStreamAttachResponse` | Subscribe; returns compact replay when streaming |
| `Ai_Stream_Detach` | `{ topicId }` | void | Unsubscribe (stream continues) |
| `Ai_Stream_Abort` | `{ topicId }` | void | Stop current generation |

> Topic status snapshots need no dedicated IPC: a new window pulls every
> `topic.stream.statuses.${topicId}` entry via `Cache_GetAllShared` on
> mount, and `useSharedCache` subscribes by topicId.

### Push channels (Main → Renderer)

| Channel | Payload | Notes |
|---|---|---|
| `Ai_StreamChunk` | `{ topicId, executionId?, chunk }` | Multi-model carries `executionId`; **only sent to attached windows** |
| `Ai_StreamDone` | `{ topicId, executionId?, status, isTopicDone }` | `status ∈ { 'success', 'paused' }` — natural completion vs user abort; **only sent to attached windows** |
| `Ai_StreamError` | `{ topicId, executionId?, isTopicDone, error }` | `SerializedError`; **only sent to attached windows** |

Topic-level status transitions are NOT a bespoke IPC — they live in the
SharedCache key `topic.stream.statuses.${topicId}` (Main `setShared` →
built-in `Cache_Sync` broadcast). The entry shape is
`TopicStatusSnapshotEntry`:

```typescript
{
  status: 'pending' | 'streaming' | 'done' | 'aborted' | 'awaiting-approval' | 'error'
  activeExecutions: ActiveExecution[]         // execs currently `streaming`
  awaitingApprovalAnchors: ActiveExecution[]  // execs with awaitingApproval = true
  lastCompletedAt?: number                    // bumped only on `done`; the fulfilled-badge read-receipt gate
}
```

`pending` doubles as the "new stream just created" signal — the old
`Ai_StreamStarted` IPC is gone. Grace-period cleanup does NOT clear the
entry — terminal values (`done` / `aborted` / `error`) stay so renderer
consumers (DB-refresh trigger, awaiting-approval indicators, sidebar
badges) can observe them. The badge "should I show this?" gate is a
read-receipt: `entry.lastCompletedAt` (authoritative, bumped only on
`done`) compared against `topic.stream.last_seen_completion.${topicId}`
(cross-window shared cache, written by the renderer when the user
acknowledges).

**All traffic is keyed by topicId**; multi-model uses `executionId` to
demux chunks per model.

**Topic status vs message status.** Don't conflate:

- **Topic stream status** (SharedCache `topic.stream.statuses.${topicId}`):
  one entry per topic, source of truth is `ActiveStream.status`, valid
  only while the `ActiveStream` exists (+ grace period).
- **Assistant message status** (`AssistantMessageStatus`: `PENDING` /
  `PROCESSING` / `SUCCESS` / `ERROR`): one per assistant message,
  persisted in SQLite, written by `PersistenceListener.onDone/onError`.
  In multi-model, a single topic-level transition corresponds to N
  separate message rows.

## ChatContextProvider — per-topicId namespace dispatch

`Ai_Stream_Open` is handled in Main by `dispatchStreamRequest`
(`context/dispatch.ts`):

```
dispatchStreamRequest(manager, subscriber, req)
  → provider = providers.find(p => p.canHandle(req.topicId))
  → prepared = await provider.prepareDispatch(subscriber, req, { hasLiveStream })
  → result   = manager.send(prepared)        // ← the only manager.send call
  → return { mode, executionIds?, userMessageId?, placeholderIds? }
```

Providers only "prepare" — they never call `manager.send` directly. Two
benefits:

- Provider unit tests assert on `PreparedDispatch` shape without mocking
  the manager.
- The restart / start / multi-model fan-out routing lives in exactly one
  place.

### Provider interface

```typescript
interface ChatContextProvider {
  readonly name: string
  canHandle(topicId: string): boolean
  prepareDispatch(
    subscriber: StreamListener,
    req: MainDispatchRequest,
    ctx: { hasLiveStream: boolean }
  ): Promise<PreparedDispatch>
}

interface PreparedDispatch {
  topicId: string
  models: ReadonlyArray<{ modelId: UniqueModelId; request: AiStreamRequest; rootSpan?: Span }>
  listeners: StreamListener[]   // subscriber + per-execution PersistenceListener(s)
  userMessageId?: string
  pendingSteerUserMessageId?: string   // persistent steer branch only; marks the dispatch enqueue-only
  reservedMessages?: CherryUIMessage[] // user/assistant skeletons created for this dispatch
  siblingsGroupId?: number
  isMultiModel: boolean
  lifecycle?: StreamLifecycle
}

// dispatch.ts also accepts two Main-internal variants synthesised internally —
// `continue-conversation` (tool-approval IPC handler) and `steer-continuation`
// (chat steer drain) — neither exposed over the renderer ↔ main contract.
type MainDispatchRequest = AiStreamOpenRequest | MainContinueConversationRequest | MainSteerContinuationRequest
```

### Built-in providers

| Provider | `canHandle` | Data layer | User message | Assistant message |
|---|---|---|---|---|
| **AgentChatContextProvider** | `topicId.startsWith('agent-session:')` | `agentMessageRepository` | written upfront | runtime provides `PersistenceListener(AgentSessionMessageBackend)` |
| **TemporaryChatContextProvider** | `temporaryChatService.hasTopic(topicId)` | `TemporaryChatService` (in-memory) | appended upfront | `PersistenceListener(TemporaryChatBackend)` appends on done |
| **PersistentChatContextProvider** | `true` (catch-all) | `messageService` + SQLite | transactional create | `PersistenceListener(MessageServiceBackend)` updates pending on done |

Order: Agent → Temporary → Persistent (first `canHandle === true`
wins).

### Persistence path comparison

| | Persistent | Temporary | Agent |
|---|---|---|---|
| User message timing | before stream (tree node) | before stream (append) | before stream (agents DB) |
| Assistant placeholder | created pending before stream | none | created pending before stream (atomic with user msg) |
| Terminal write | `update` placeholder | `append` new row | `update` placeholder (`persistAssistant`) |
| Backend | `MessageServiceBackend` | `TemporaryChatBackend` | `AgentSessionMessageBackend` |
| Multi-model | ✓ | ✗ (single-model) | ✗ (single-model) |
| Regenerate | ✓ | ✗ | ✗ |

### One PersistenceListener across all topic kinds

Persistent / Temporary / Agent / Translation all share the same
`PersistenceListener` class — only the injected `PersistenceBackend`
differs. The observer protocol (`modelId` filter, error part folding,
skip-when-no-finalMessage, swallow errors) is implemented once.

## AiService integration

`AiService` is a lifecycle service:

- **Streaming.** `streamText(request)` returns
  `Promise<ReadableStream<UIMessageChunk>>`, consumed by
  `AiStreamManager.runExecutionLoop`.
- **Non-streaming IPC gateway.** `generateText` / `checkModel` /
  `embedMany` / `generateImage` / `listModels`, registered as IPC
  handlers in `onInit`.

`AiStreamManager` calls `await application.get('AiService').streamText(...)`.
Pre-stream errors (provider / model resolution, agent param build)
reject the returned Promise; mid-stream errors come through the returned
stream's error path — the two error paths never overlap.

## Grace period & reconnect

After a stream terminates, `ActiveStream` stays in memory for 30 s
(`config.gracePeriodMs`). During that window a returning user can
`attach` and pull `finalMessage` without a DB read. After expiry the
entry is evicted; subsequent `attach` returns `not-found` and the
renderer reads from the DB through `useQuery` (PersistenceListener has
already written by then).

If the user stops and immediately retries on the same topic, `send`
takes the start branch: `evictStream` first clears the grace-period
remnant (cancels the cleanup timer and drops the entry from
`activeStreams`), then the new stream is created — the old never blocks
the new.

## Edge case cheat sheet

| Case | Handling |
|---|---|
| User sends again on the same topic mid-stream (chat) | provider persists the steer row + `enqueuePendingSteer`; the running turn yields (`steerYield`) and persists as `success`, then `onExecutionDone` chains a `steer-continuation` |
| Retry immediately after stream ends | `send` takes start; `evictStream` clears the grace-period entry first |
| Window closes mid-stream | Next broadcast sees `WebContentsListener.isAlive() === false` and removes it; `PersistenceListener` doesn't depend on a window |
| All windows closed + `backgroundMode='continue'` | Stream continues; `PersistenceListener` persists when done |
| All windows closed + `backgroundMode='abort'` | `onChunk` finds `stream.listeners.size === 0` → `abort(topicId, 'no-subscribers')`; partial persisted as `paused` |
| Multi-window on same topic | Each window has its own `WebContentsListener`; chunks fan out to all alive listeners |
| Same window re-attaches | Listener id is stable (`wc:${wc.id}:${topicId}`); `addListener` upserts by id |
| Attach mid-stream | `attach` returns compact replay per execution (each buffer compacted independently); observer fills in the gap |
| Ring buffer overflow | At `maxBufferChunks` the oldest chunk drops and `droppedChunks++`; subsequent attach logs the total dropped — replay is no longer lossless |
| Multi-model + resubmit | the steer is queued once per topic; every model's execution yields via `steerYield`, and the single continuation answers it after the turn completes |
| Stream emits `tool-approval-request` | `exec.awaitingApproval = true`; on stream end the topic surfaces `awaiting-approval` via the shared cache |
| Main process restart | `activeStreams` clears; in-flight streams are lost; the renderer re-reads from the DB |

## Design notes

### Testing strategy

- **Manager tests.** `new AiStreamManager({ maxBufferChunks: 3 })` via
  the optional config arg; state assertions go through `mgr.inspect(topicId)`;
  listener upsert / abort / backgroundMode are tested via behaviour
  (drive a chunk, assert which listeners received it).
- **Provider tests.** Assert on the returned `PreparedDispatch` shape
  directly — no manager mock.
- **PersistenceListener tests.** `TemporaryChatBackend` as the test
  vehicle covers the observer protocol once for every backend.
- All internal state has a public inspection API; production and tests
  share the same contract.
