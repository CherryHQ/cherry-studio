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
            │  executionId into            │
            │  per-execution branches ─────┘
            ▼
       branch ReadableStream  →  useExecutionOverlay (per execution)
```

## TopicStreamSubscription

`src/renderer/transport/TopicStreamSubscription.ts`. A renderer
class that owns:

- **One IPC attach per topic.** `attach` is ref-counted — every
  execution that calls `register(executionId)` increments the count;
  the last `unregister` triggers `detach` (deferred one microtask so a
  transient `activeExecutions` flicker doesn't detach-then-reattach).
- **Per-execution demux.** Each `register(executionId)` returns a
  `ReadableStream<UIMessageChunk>` that contains only the chunks tagged
  with that `executionId` by Main. Multi-model parallel responses each
  get their own branch.
- **Synchronous controller creation.** The branch's
  `ReadableStreamDefaultController` is created during the
  `new ReadableStream({ start })` call (synchronous), so chunks that
  arrived between `register` and the reader's first `read()` are
  already buffered in the stream's internal queue — late readers never
  miss replayed chunks.
- **Terminal demux.** `Ai_StreamDone` / `Ai_StreamError` close the
  matching branch and fan out an `ExecutionTerminal` (`{ isAbort,
  isError }`) to listeners; if the payload carries `isTopicDone` or no
  `executionId`, every branch terminates together.

### Cancellation layering — do not conflate

| Layer | Owner | Action |
|---|---|---|
| Renderer-local subscription | `TopicStreamSubscription.unregister` / `dispose` | Closes the branch reader, drops listener ref count; Main keeps generating |
| Generation abort | Main (via `useChatWithHistory.stop` → Chat → `Ai_Stream_Abort`) | Stops the LLM |

`TopicStreamSubscription` NEVER aborts the LLM. Closing all branches
is the renderer equivalent of `streamDetach` — Main keeps streaming,
other windows keep observing.

### Defensive routing

A chunk without `executionId` is unexpected — Main always tags chat
chunks. As a defensive fallback, if exactly one branch is registered
the chunk routes there; otherwise it's dropped with a warning.

## useExecutionOverlay

`src/renderer/hooks/useExecutionOverlay.ts`. The per-execution
overlay, built on `useTopicStreamSubscription`.

```ts
const { overlay, liveAssistants, disposeOverlay, reset } = useExecutionOverlay(
  topicId,
  activeExecutions,      // ActiveExecution[] from useTopicStreamStatus
  uiMessages,            // current DB snapshot
  { onFinish }
)
```

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

### Lifecycle

1. **Topic switch** — every reader is cancelled, every branch
   unregistered, `snapshots` cleared. `prevTopicRef` is checked in the
   render body so the cleanup runs synchronously before the new topic's
   readers start.
2. **`activeExecutions` change** — diff against the current reader
   map: cancel + unregister executions no longer in the active list;
   for newly-active executions, register a branch, clear any retained
   prior snapshot, kick a new reader.
3. **Terminal** — the branch is closed by `TopicStreamSubscription`;
   the reader's `for await` exits. The `onFinish(executionId, event)`
   callback fires with the final snapshot + `{ isAbort, isError }`.
4. **Unmount** — every reader is cancelled, every branch unregistered.

### Overlay teardown is monotonic

`disposeOverlay(messageId)` drops exactly one snapshot entry. The chat
shell wires this so the overlay is released **only after** the DB
refresh promise resolves (see `.finally(() => disposeOverlay(...))` in
`V2ChatContent`). That ordering eliminates the visible flash between
"streaming overlay" and "persisted parts": the SWR cache holds the
authoritative row before the overlay disappears.

The renderer never writes streamed parts to SWR — writing them would
race the DB-authoritative refresh and cause flicker.

### Why retained snapshots after terminal

The hook keeps the final snapshot in `snapshots` until one of:

- the same execution restarts (next turn clears it),
- the caller calls `disposeOverlay(messageId)` (post-persist handoff),
- the caller calls `reset()` (e.g. quick-assistant clear),
- the topic switches (effect clears all snapshots).

That retention lets consumers read the final frame for the brief window
between stream-end and DB-refresh-complete without going through SWR.

## React binding

`useTopicStreamSubscription(topicId)` is the React wrapper:

- Lazy-init per `topicId` (idiom mirrors `useState(() => ...)`).
- Disposed on unmount or topic switch — drops the Main listener and
  closes every branch.

Each mounted topic gets one `TopicStreamSubscription` instance, shared
by every consumer in that React tree (today: `useExecutionOverlay`).

## Code map

```
src/renderer/transport/TopicStreamSubscription.ts   ← class
src/renderer/hooks/useTopicStreamSubscription.ts    ← React binding
src/renderer/hooks/useExecutionOverlay.ts           ← per-execution readers + overlay
src/renderer/pages/home/V2ChatContent.tsx           ← consumer + dispose-after-refresh
```

## Invariants reviewers should check

1. **Same merge function on both sides.** Any code that re-implements
   chunk → message assembly on the renderer (instead of feeding
   `readUIMessageStream`) is wrong — that's where Main and renderer
   will diverge first.
2. **One reader per turn.** No reader should be reused across
   `activeExecutions` transitions. Reusing one is what the v1 `Chat`
   bug was; the structural fix is structural.
3. **Seed from current DB.** `pickSeed` reads `uiMessagesRef.current`
   at reader-start time. Stashing the seed on first mount and reusing
   it across turns would defeat the continue-conversation case.
4. **Overlay disposed after DB refresh.** Any
   `disposeOverlay(messageId)` call that runs **before** the DB
   revalidation promise resolves is a flicker bug.
5. **`TopicStreamSubscription` never aborts.** It only detaches.
   Anything in this layer that calls `Ai_Stream_Abort` is in the
   wrong place — abort belongs to `useChatWithHistory.stop`.
6. **Ref-counted attach.** A new attach must NOT fire when another
   execution is already registered for the same topic. A new detach
   must NOT fire while any execution still has a branch.

## Where to read more

- Main-side accumulator: [Stream Manager — `pipeStreamLoop`](./stream-manager.md#execution-loop--runexecutionloop--pipestreamloop)
- IPC envelope: [IPC Transport](./ipc-transport.md)
- Topic status / approval-anchor surfacing: [Tool Approval](./tool-approval.md)
- AI SDK upstream: [`readUIMessageStream` reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/read-ui-message-stream)
