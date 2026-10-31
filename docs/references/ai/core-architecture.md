---
description: End-to-end chat turn flow from renderer IPC transport through AiStreamManager and Agent loop to persistence
sources:
  - src/main/ai/streamManager
  - src/main/ai/AiService.ts
  - src/main/ipc/handlers/ai.ts
  - src/renderer/services/aiTransport
---

# Core Architecture

End-to-end view of how a Cherry chat turn moves from user input to LLM
response and back to UI, with pointers to the focused references for
each subsystem.

## Layered view

```text
Renderer: commands → ai.stream.open/abort → AiStreamManager
          views    ← ai.projection.* ← root/child message publishers
Main: context provider → AiService → one source per execution
      chunks → pipeStreamLoop → readUIMessageStream → CherryUIMessage
      messages → pipeMessageStream → host display state → CherryUIMessage
      current CherryUIMessage → root projection + listeners + persistence
      child native observation → reconciliation/archive → independent child projection
Terminal: persistence → projection and other subscriber notifications → cleanup
Model requests: existing provider registry / gateway / AI SDK paths remain unchanged
```

## Sequence: a fresh chat turn

1. User hits send. The command hook or conversation controller captures the input and topic.
2. It packages `AiStreamOpenRequest`, dispatches via
   `streamDispatchService` over IpcApi `ai.stream.open`.
3. The `ai.stream.open` handler in `src/main/ipc/handlers/ai.ts` resolves the
   managed sender window and calls `AiStreamManager.dispatchCommand`. Observation is a separate projection subscription.
4. `dispatchStreamRequest` picks the first `ChatContextProvider` whose
   `canHandle(topicId)` matches and asks it to `prepareDispatch`.
5. The provider resolves models, persists the user message for persistent chat
   or skips it for temporary chat, creates `PersistenceListener` per
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
8. The returned `AiStreamSource` selects one consumer. `chunks` uses `pipeStreamLoop`
   and `readUIMessageStream`; `messages` uses `pipeMessageStream` to apply host display
   state to authoritative bodies. Listeners receive `onMessage` snapshots, and
   persistence uses that same final view. Pi, Pi Durable, and Claude select
   `messages`; Chat retains its chunk source.
9. On terminal (`done` / `error` / `aborted` / `awaiting-approval`):
   - `PersistenceListener` writes the final assistant message.
   - `TopicMessageProjection` publishes the final message and terminal state to subscribed windows.
   - Shared-cache `topic.stream.statuses.<topicId>` flips to the terminal status.
10. Renderer's `useQuery('/topics/:topicId/messages')` revalidates; the
    optimistic overlay is disposed.

## Sequence: tool approval pause + resume

1. AI SDK calls `tool.execute(args, toolCallContext)`. The wrapper sees
   `needsApproval(args)` returns true and the assistant's auto-approve
   policy says "ask". It writes an `approval-requested` part on the
   accumulated message and holds the promise.
2. Manager flips status to `awaiting-approval` on the shared cache.
3. Renderer's `useTopicAwaitingApproval(topicId)` returns true; the UI
   shows the approval card.
4. User decides → `useToolApprovalBridge` → `ai.tool.respond_approval`.
5. Main applies the decision to the anchor row, resumes the stream
   (agent-session runtime: resolves the live approval registry entry; MCP:
   dispatches a `continue-conversation` so the existing stream rebroadcasts).
6. Status flips back to `streaming`; UI hides the card.

See [Tool Approval](./tool-approval.md) for invariants and the
overlay-vs-persist conditional write.

## Key subsystems

| Subsystem | Reference |
|---|---|
| Active-stream registry, listeners, persistence backends, reconnect, abort, grace-period eviction | [Stream Manager](./stream-manager.md) |
| Agent-session host plus Claude Code and Pi runtime drivers | [Agent Session Runtime](./agent-session-runtime.md) |
| `Agent.stream` single-pass loop, hooks model, error/abort | [Agent Loop](./agent-loop.md) |
| `buildAgentParams`, `RequestFeature` composition, `INTERNAL_FEATURES` order | [Params Pipeline](./params-pipeline.md) |
| Tool registry, MCP sync, meta-tools (`tool_search` / `tool_inspect` / `tool_invoke` / `tool_exec`), defer exposition | [Tool Registry](./tool-registry.md) |
| `Provider.endpointConfigs`, `endpointType` resolution, variant suffixes, custom providers | [Provider Resolution](./provider-resolution.md) |
| `adapterFamily` field, runtime resolver, write paths (catalog / migrator) | [Adapter Family](./adapter-family.md) |
| OTel span tree, `AdapterTracer`, `AiSdkSpanAdapter`, dev-tools view | [Observability](./observability.md) |
| Commands, dispatch results and shared projection subscriptions | [IPC Transport](./ipc-transport.md) |
| Approval flow, Main-as-writer invariant, persistent decisions | [Tool Approval](./tool-approval.md) |

## Invariants

- **Topic-level addressing.** Root chat streams are keyed by `topicId`.
  A topic has at most one active stream; subscribers are equal — there is no
  "owner" window. Pi child projections have independent owner-scoped subscriptions
  and archives; parent completion does not close them.
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
├── AiService.ts                  ← provider operations, built-in tool init, approval decisions
├── runtime/                      ← aiSdk plus claudeCode / pi agent-session drivers
├── agentSession/                 ← agent-session topic host
├── agents/                       ← AgentJobsService, AgentTaskJobHandler, runAgentTask, prompt, heartbeat
├── channels/                     ← ChannelManager + IM adapters (discord/feishu/qq/slack/telegram/wechat) + security/
├── streamManager/                ← AiStreamManager, listeners, persistence, dispatch
├── provider/                     ← provider config, endpoint resolution, custom providers
├── mcp/                          ← McpRuntimeService / McpCatalogService, oauth, built-in servers
├── skills/                       ← SkillService, SkillInstaller
├── contextBuild/                 ← context policy, compression, persisted tool outputs
├── inference/                    ← local embedding/OCR inference
├── tokens/                       ← token estimators and modality profiles
├── tools/                        ← AI SDK registry and runtime-specific adapters
├── observability/                ← AI trace adapters, local projection, sinks
├── messages/                     ← UI part → AI SDK part conversion
├── types/                        ← AppProviderId, merged types, request types
└── utils/                        ← reasoning / model parameters / options / websearch

src/main/ipc/handlers/ai.ts        ← IpcApi transport adapters
src/renderer/services/aiTransport/ ← MessageProjectionService, StreamDispatchService, overlays
src/renderer/hooks/               ← useChatWithHistory, useToolApprovalBridge, useTopicStreamStatus
packages/aiCore/                  ← @cherrystudio/ai-core (Agent + plugins + provider extensions)
packages/provider-registry/       ← provider catalog, registry-utils (adapterFamily inference)
```
