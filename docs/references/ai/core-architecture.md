# Core Architecture

End-to-end view of how a Cherry chat turn moves from user input to LLM
response and back to UI, with pointers to the focused references for
each subsystem.

## Layered view

```
┌──────────────────────────────────────────────────────────────────────┐
│                            Renderer                                  │
│                                                                      │
│  useChat({ id: topicId, transport: IpcChatTransport })               │
│    ├─ sendMessages   → window.api.ai.streamOpen                       │
│    ├─ reconnectToStream → window.api.ai.streamAttach                  │
│    └─ abort signal   → window.api.ai.streamAbort                      │
│                                                                      │
│  History:           useQuery('/topics/:id/messages') → DataApi        │
│  Topic-level state: useTopicStreamStatus → shared cache              │
│  Approval bridge:   useToolApprovalBridge → window.api.ai.toolApproval│
└──────────────────────────────────────────────────────────────────────┘
                                 ↕ IPC (keyed by topicId)
┌──────────────────────────────────────────────────────────────────────┐
│                              Main                                    │
│                                                                      │
│  AiStreamManager (lifecycle service) — registers in onInit:          │
│    ├─ ipcHandle('Ai_Stream_Open',   → dispatchStreamRequest)          │
│    ├─ ipcHandle('Ai_Stream_Attach', → this.attach)                    │
│    ├─ ipcHandle('Ai_Stream_Detach', → this.detach)                    │
│    └─ ipcHandle('Ai_Stream_Abort',  → this.abort)                     │
│                                                                      │
│  AiService (lifecycle service) — registers:                          │
│    ├─ ipcHandle('Ai_ToolApproval_Respond', <inline handler>)          │
│    └─ ipcHandle('Ai_GenerateText' / 'Ai_Translate_Open' / …)          │
│                                                                      │
│  dispatch (src/main/ai/streamManager/context/dispatch.ts)            │
│    pick ChatContextProvider → prepareDispatch → manager.send(...)     │
│                                                                      │
│  AiStreamManager                                                     │
│    activeStreams: Map<topicId, ActiveStream>                          │
│      listeners + executions                                          │
│    runs N StreamExecution loops, fan-out per chunk to listeners       │
│                                                                      │
│  runExecutionLoop (AiStreamManager) → AiService.streamText(req,signal)│
│    buildAgentParams: registry.selectActive + applyDeferExposition     │
│    new Agent({tools, hookParts}) — composeHooks runs inside Agent     │
│    → agent.stream(messages, signal)                                   │
│    pipeStreamLoop tees:                                              │
│      • broadcast → WebContents / SSE / channel-adapter / persistence │
│      • readUIMessageStream → CherryUIMessage snapshot                │
│                                                                      │
│  Terminal listeners:                                                 │
│    PersistenceListener → MessageService / TemporaryChat / Translation
│    WebContentsListener  → wc.send(Ai_StreamDone)                      │
│    ChannelAdapterListener → adapter.onStreamComplete                  │
│    SseListener          → res.write('[DONE]')                         │
└──────────────────────────────────────────────────────────────────────┘
                                 ↓
                        @ai-sdk/* package
                                 ↓
                          LLM provider API
```

## Sequence: a fresh chat turn

1. User hits send. `useChat.sendMessages` calls `IpcChatTransport.sendMessages`.
2. Transport packages `AiStreamOpenRequest`, dispatches via
   `streamDispatchCoordinator` over IPC `Ai_Stream_Open`.
3. `AiStreamManager`'s `Ai_Stream_Open` handler (registered in `onInit`)
   wraps the sender in a `WebContentsListener` and calls
   `dispatchStreamRequest(manager, subscriber, request)`.
4. `dispatchStreamRequest` picks the first `ChatContextProvider` whose
   `canHandle(topicId)` matches and asks it to `prepareDispatch`.
5. The provider resolves models, persists the user message (chat) or skips
   persistence (temporary / translate), creates `PersistenceListener` per
   execution, returns `PreparedDispatch`.
6. `dispatch` reconciles any live stream, then calls `manager.send(input)`:
   - **chat resubmit** (topic already streaming): the provider persists the
     steer user row and `dispatch` calls `manager.enqueuePendingSteer(topicId)`;
     `send()` **injects** (just upserts the subscriber). The running turn yields
     via `steerYield` (persisting as `success`) and `onExecutionDone` chains a
     `steer-continuation` — steering is enqueue + yield + chain, not
     abort-and-restart and not mid-turn injection.
   - **agent-session follow-up**: the stream is left running and `send()`
     **injects** — it upserts `listeners` onto the running stream, `models`
     ignored (the message was already enqueued on the session's `pendingTurns`).
   - **no live stream**: `send()` **starts** — evict any grace-period stream,
     create an `ActiveStream`, launch one `StreamExecution` per model.
7. For each `StreamExecution`, `AiStreamManager`'s private `runExecutionLoop`
   calls `AiService.streamText(request, signal)`, which builds params
   (`buildAgentParamsFor → buildAgentParams`: `registry.selectActive` +
   `applyDeferExposition` + per-feature hooks), constructs an `Agent`
   (`composeHooks` folds observers + caller + features inside `Agent`), and
   calls `agent.stream(messages, signal)` — which opens AI SDK's stream and
   yields `UIMessageChunk`s. Agent-session runtime requests skip the generic
   agent loop here: `AiService.streamText()` calls
   `AgentSessionRuntimeService.openTurnStream()` so the registered driver
   can own the concrete agent runtime.
8. `pipeStreamLoop` reads the chunk stream once, tees: broadcast to
   listeners, accumulate via `readUIMessageStream`.
9. On terminal (`done` / `error` / `aborted` / `awaiting-approval`):
   - `PersistenceListener` writes the final assistant message.
   - `WebContentsListener` broadcasts `Ai_StreamDone` to subscribed windows.
   - Shared-cache `topic.stream.statuses.<topicId>` flips to the terminal status.
10. Renderer's `useQuery('/topics/:id/messages')` revalidates; the
    optimistic overlay is disposed.

## Sequence: tool approval pause + resume

1. AI SDK calls `tool.execute(args, toolCallContext)`. The wrapper sees
   `needsApproval(args)` returns true and the assistant's auto-approve
   policy says "ask". It writes an `approval-requested` part on the
   accumulated message and holds the promise.
2. Manager flips status to `awaiting-approval` on the shared cache.
3. Renderer's `useTopicAwaitingApproval(topicId)` returns true; the UI
   shows the approval card.
4. User decides → `useToolApprovalBridge` → `Ai_ToolApproval_Respond`.
5. Main applies the decision to the anchor row, resumes the stream
   (Claude-Agent: resolves the `canUseTool` promise; MCP: dispatches a
   `continue-conversation` so the existing stream rebroadcasts).
6. Status flips back to `streaming`; UI hides the card.

See [Tool Approval](./tool-approval.md) for invariants and the
overlay-vs-persist conditional write.

## Key subsystems

| Subsystem | Reference |
|---|---|
| Active-stream registry, listeners, persistence backends, reconnect, abort, grace-period eviction | [Stream Manager](./stream-manager.md) |
| Claude Code agent-session long-lived runtime, SDK input queue, resume fallback | [Agent Session Runtime](./agent-session-runtime.md) |
| `Agent.stream` single-pass loop, hooks model, error/abort | [Agent Loop](./agent-loop.md) |
| `buildAgentParams`, `RequestFeature` composition, `INTERNAL_FEATURES` order | [Params Pipeline](./params-pipeline.md) |
| Tool registry, MCP sync, meta-tools (`tool_search` / `tool_inspect` / `tool_invoke` / `tool_exec`), defer exposition | [Tool Registry](./tool-registry.md) |
| `Provider.endpointConfigs`, `endpointType` resolution, variant suffixes, custom providers | [Provider Resolution](./provider-resolution.md) |
| `adapterFamily` field, runtime resolver, write paths (catalog / migrator) | [Adapter Family](./adapter-family.md) |
| OTel span tree, `AdapterTracer`, `AiSdkSpanAdapter`, dev-tools view | [Observability](./observability.md) |
| `IpcChatTransport`, dispatch coordinator, per-execution demux | [IPC Transport](./ipc-transport.md) |
| Approval flow, Main-as-writer invariant, persistent decisions | [Tool Approval](./tool-approval.md) |

## Invariants

- **Topic-level addressing.** Every IPC, broadcast, and shared-cache
  entry is keyed by `topicId`. A topic has at most one active stream;
  subscribers are equal — there is no "owner" window.
- **Main owns persistence.** Renderer closing or crashing does not abort
  the stream or lose data. `PersistenceListener` writes on terminal
  regardless of subscriber state.
- **Main owns approval state.** The renderer is never a writer.
- **Adapter family is per-endpoint.** Multi-endpoint relays may use
  different `@ai-sdk/*` packages on different endpoints under the same
  `provider.id`.
- **`tools/applies` predicates are pure.** They run on every
  `selectActive` pass; side effects there break tool selection
  determinism.
- **Features must not mutate `RequestScope`.** It is shared across all
  features for a single request.

## Code map

```
src/main/ai/
├── AiService.ts                  ← lifecycle owner, IPC entry (generate / translate / approval)
├── runtime/                      ← execution backends: runtime/aiSdk (Agent + params), runtime/claudeCode
├── agentSession/                 ← agent-session topic host
├── agents/                       ← AgentJobsService, AgentTaskJobHandler, runAgentTask, cherryclaw
├── channels/                     ← ChannelManager + IM adapters (discord/feishu/qq/slack/telegram/wechat) + security/
├── streamManager/                ← AiStreamManager, listeners, persistence (registers the stream IPC)
├── provider/                     ← provider config, endpoint resolution, custom providers
├── mcp/                          ← McpRuntimeService / McpCatalogService, oauth, built-in servers
├── skills/                       ← SkillService, SkillInstaller
├── tools/                        ← unified tool registry (adapters/aiSdk + adapters/claudeCode)
├── observability/                ← AI trace adapters, local projection, sinks
├── messages/                     ← UI part → AI SDK part conversion
├── types/                        ← AppProviderId, merged types, request types
└── utils/                        ← reasoning / model parameters / options / websearch

src/renderer/transport/           ← IpcChatTransport, dispatch coordinator
src/renderer/hooks/               ← useChatWithHistory, useToolApprovalBridge, useTopicStreamStatus
packages/aiCore/                  ← @cherrystudio/ai-core (Agent + plugins + provider extensions)
packages/provider-registry/       ← provider catalog, registry-utils (adapterFamily inference)
```
