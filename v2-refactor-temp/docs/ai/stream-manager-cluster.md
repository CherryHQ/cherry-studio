# Stream Manager — Reviewer Cluster

## Scope

| Subpath | Files | Role |
|---|---|---|
| `src/main/ai/streamManager/` | `AiStreamManager.ts` (1004), `index.ts`, `types.ts` (311), `pipeStreamLoop.ts` (141), `buildCompactReplay.ts` | The broker itself + shared chunk-pipe primitive |
| `stream-manager/context/` | `ChatContextProvider.ts`, `PersistentChatContextProvider.ts`, `TemporaryChatContextProvider.ts`, `AgentChatContextProvider.ts`, `dispatch.ts`, `modelResolution.ts` | Per-topic-namespace bundle producers + the single dispatch entry |
| `stream-manager/lifecycle/` | `StreamLifecycle.ts`, `ChatStreamLifecycle.ts`, `PromptStreamLifecycle.ts` | Strategy for status broadcast, attach gating, grace-period cleanup |
| `stream-manager/listeners/` | `WebContentsListener.ts`, `PersistenceListener.ts`, `SseListener.ts`, `ChannelAdapterListener.ts` | Concrete subscribers of the chunk stream |
| `stream-manager/persistence/` | `PersistenceBackend.ts` + 4 backends (`MessageService`, `TemporaryChat`, `AgentMessage`, `Translation`) | Storage strategy |
| Tests | `__tests__/AiStreamManager.test.ts` (927), `__tests__/buildCompactReplay.test.ts`, `context/__tests__/`, `listeners/__tests__/`, `persistence/backends/__tests__/` | Per-file coverage |

## Intent

**v1 was single-use IPC pipes.** `event.sender.send(chunk)` per chunk;
when the renderer window closed mid-stream the upstream `cancel()` cascaded
back through Transport → Chat → `useChat` ref and aborted the LLM
request. No persistence on Main. No reconnect after route change.

**v2 turns streams into broker state.** A topic owns an `ActiveStream`
record; renderers subscribe instead of consume; persistence lives on Main
behind a strategy interface; the manager is the single place that knows
about status, grace-period cleanup, multi-model fan-out, mid-stream
injection.

The architecture is fully described in
[`docs/references/ai/stream-manager.md`](../../../docs/references/ai/stream-manager.md) —
this cluster doc focuses on what changed and what reviewers should check.

## Key changes

### Single dispatcher path (`context/dispatch.ts`)

`dispatchStreamRequest(manager, request)` is the only place that calls
`manager.send(...)`. Two callers feed it:

- `Ai_Stream_Open` IPC handler (renderer-driven submit/regenerate)
- `Ai_ToolApproval_Respond` IPC handler (synthetic
  `continue-conversation` after every approval on a turn decides)

Both shapes meet here as `MainDispatchRequest`. Providers
(`PersistentChatContextProvider` / `TemporaryChatContextProvider` /
`AgentChatContextProvider`) only produce a `PreparedDispatch` bundle;
they never call `manager.send` directly.

**Why:** Providers were originally calling `manager.send` themselves,
which duplicated the inject-vs-start logic per provider and made the
multi-model fan-out contract hard to enforce in tests.

### `ChatContextProvider` interface

```ts
interface ChatContextProvider {
  readonly name: string
  canHandle(topicId: string): boolean
  prepareDispatch(subscriber: StreamListener, req, ctx: DispatchContext)
    : Promise<PreparedDispatch>
}
```

`PreparedDispatch` carries `{ models, listeners, userMessage?, userMessageId?, siblingsGroupId?, isMultiModel, lifecycle? }`.
The dispatcher reads `manager.activeStreams.get(topicId)` to set
`DispatchContext.hasLiveStream` so providers can shortcut persistence on
the inject path.

### Lifecycle strategy split

`ChatStreamLifecycle` (chat default) and `PromptStreamLifecycle`
(translate / summarisation / model probes) differ in:

- **Status broadcast** — chat publishes `topic.stream.statuses.<topicId>`
  to shared cache; prompt-stream doesn't.
- **Attach gating** — chat allows attach during grace-period; prompt
  doesn't.
- **Cleanup timing** — chat holds the entry 30 s after terminal so a
  freshly-mounted renderer can still attach; prompt evicts immediately.

The split is on the lifecycle strategy, not on the manager — manager
code branches only on `stream.lifecycle.cleanup(...)`.

### Persistence backends

`PersistenceListener` is storage-agnostic; it folds error parts into
`finalMessage.parts` and calls the backend's `persistAssistant` /
`persistTranslate` / etc. Stream-manager owns these built-in backends:

- `MessageServiceBackend` — persistent chats (SQLite tree).
- `TemporaryChatBackend` — temporary topics (in-memory).
- `TranslationBackend` — translate-on-main rows (see
  [translate-on-main.md](./translate-on-main.md)).

Agent session persistence is owned by `agent-session/persistence`, not
by stream-manager.

### `pipeStreamLoop`

Shared chunk-pipe primitive driven from `AiStreamManager.runExecutionLoop`
— every execution runs through it, chat turns and ad-hoc prompt streams
(`streamPrompt`) alike. Tees the broadcast reader from the
`readUIMessageStream` accumulator. Behaviour contract is in the file
header — focus check: never-throws, captures `streamErrorText` for
in-stream `chunk.type === 'error'`, returns `threw` for setup errors.

## Invariants reviewers should check

1. Every `manager.send` call goes through `dispatch.ts`. Providers never
   import `AiStreamManager` directly to call methods on it.
2. A topic has exactly one `ActiveStream`. The inject path never spawns
   new `StreamExecution`s.
3. Terminal callbacks (`onDone` / `onPaused` / `onError`) fire exactly
   once per execution.
4. `WebContentsListener` survives window close — only the IPC send
   becomes a no-op; the stream and persistence continue.
5. Grace-period cleanup (`ChatStreamLifecycle.cleanup`) is cancellable
   by a new `send` on the same topic.

## Validation

- `__tests__/AiStreamManager.test.ts` — 927-line suite, covers
  start/inject/abort/reconnect/persistence/multi-model.
- `context/__tests__/TemporaryChatContextProvider.test.ts` — temporary
  topic path.
- `listeners/__tests__/WebContentsListener.test.ts` — dead-listener
  removal.
- `listeners/__tests__/PersistenceListener.test.ts` — error-part folding,
  per-execution filtering.
- `persistence/backends/__tests__/TranslationBackend.test.ts` —
  translate row write path.
- `__tests__/buildCompactReplay.test.ts` — replay buffer compaction.

## Follow-ups (out of scope)

- Stream resume across Main process restart (currently all in-memory).
- SSE listener: only used by the dev API server; can it move to the
  apiServer cluster? Decision deferred.
