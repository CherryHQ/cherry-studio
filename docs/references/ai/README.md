---
description: Entry point mapping the AI pipeline docs, src/main/ai code layout, chat-turn flow, runtimes, and key invariants
sources:
  - src/main/ai
  - src/renderer/services/aiTransport
---

# AI Reference

This is the entry point for Cherry Studio's AI pipeline: main-process provider
calls, AI SDK chat execution, registered agent-session runtimes, and the
renderer-side transport that connects to them.

## Quick navigation

### Top-level architecture

| Document | What it covers |
|---|---|
| [Core Architecture](./core-architecture.md) | End-to-end call flow: `ai.stream.open` IpcApi route → context provider → AiStreamManager → runtime → broadcast / persist |
| [Stream Manager](./stream-manager.md) | Active-stream registry, listeners, reconnect, abort, queue/yield/continuation steering, persistence backends |
| [Agent Session Runtime](./agent-session-runtime.md) | Agent-session host/driver split, follow-up admission, resume persistence, and the registered Claude Code, Pi, and DSH drivers |
| [Adding an Agent Runtime](./adding-a-runtime.md) | Operational checklist for a new runtime: capability descriptor, driver package, registration points, design rules |
| [Adapter Family](./adapter-family.md) | How `provider.endpointConfigs[ep].adapterFamily` picks the right `@ai-sdk/*` package per request |
| [Provider State Ownership](./provider-state-ownership.md) | Where provider facts, endpoint dialects, connection overrides, and per-request controls belong |

### Subsystems

| Document | What it covers |
|---|---|
| [Agent Loop](./agent-loop.md) | Main-process `Agent.stream()`: single-pass stream, hook composition, observer pattern, error/abort semantics |
| [Agent Prompt Layers](./agent-prompt-layers.md) | Agent System Prompt, workspace `system.md`, `SOUL.md`, precedence, update boundary, and variable lifecycle |
| [Params Pipeline](./params-pipeline.md) | `buildAgentParams` + `RequestFeature` model: how capabilities, plugins, tools, and provider-specific quirks are composed |
| [Tool Registry](./tool-registry.md) | Built-in web/knowledge/file/image/MCP-resource tools, selected MCP tools, meta-tools, and deferred exposition |
| [Chat Attachments](./chat-attachments.md) | How attached files reach the model: native file parts when supported, capped extracted text otherwise, `read_file` for overflow paging |
| [Provider Resolution](./provider-resolution.md) | `Provider.endpointConfigs` schema, endpoint resolution chain, variant suffixes, custom provider extensions (aihubmix, newapi) |
| [Model Retry & Fallback](./model-retry.md) | `ai-retry` integration: same-model transient retry + user-configured fallback models, `wrapModel` hook, `chat.retry.*` preferences, embedding/rerank policies |
| [Observability (trace / telemetry)](./observability.md) | `AiSdkSpanAdapter`, root span propagation, OTel attribute shape, local span projection, sinks |
| [Local Models](./local-models.md) | The local embedding / OCR bundle catalog, on-disk registry, and verified acquisition of models and shared native runtimes |
| [AI Usage Records](./ai-usage-records.md) | Best-effort per-provider-invocation usage/cost analytics: capture ownership, immutable attribution snapshots, message projection, bounded query API, migration, freshness |

### Renderer-side glue

| Document | What it covers |
|---|---|
| [IPC Transport](./ipc-transport.md) | `useChat` + `IpcChatTransport`: `sendMessages` / `reconnectToStream`, dispatch service, topic-status mirror |
| [Execution Overlay](./execution-overlay.md) | `TopicStreamSubscription` + `useExecutionOverlay`: ref-counted attach, execution + anchor demux, one-shot `readUIMessageStream` per turn (the renderer half of the same merge function Main uses) |
| [Text Translation](./translation.md) | `translate.open` prompt streams, renderer-owned result handling, and Home `data-translation` persistence |
| [Tool Approval](./tool-approval.md) | Approval registry, Main-as-writer model, persistent decisions, `useToolApproval` hook |

## Where the code lives

> **Scope of the focused docs.** The reference documents in this folder map
> the **chat / stream pipeline** (dispatch → stream manager → runtime →
> tools → persistence → renderer transport). The `channels/`, `skills/`, and
> `mcp/` subsystems are mapped in the tree below but do not yet have dedicated
> deep-dive docs.

```
src/main/ai/
├── AiService.ts                  ← provider operations, built-in tool init, approval decisions
├── runtime/                      ← AI execution backends + agent-session runtime registry
│   ├── aiSdk/                    ← Agent class, loop, observers, params/features
│   ├── claudeCode/               ← Claude Code driver, warm query, SDK adapter
│   ├── pi/                       ← Pi runtime connection and approval extension
│   └── dsh/                      ← DeepSeek Harness runtime connection
├── agentSession/                 ← agent-session topic host
│   └── AgentSessionRuntimeService.ts
├── agents/                       ← AgentJobsService, AgentTaskJobHandler, runAgentTask, prompt, heartbeat, builtin/
├── channels/                     ← ChannelManager + IM adapters (discord/feishu/qq/slack/telegram/wechat) + security/
├── streamManager/                ← AiStreamManager + listeners + persistence backends
│   ├── AiStreamManager.ts        ← active-stream registry and dispatch owner
│   ├── context/                  ← ChatContextProvider implementations + dispatch
│   ├── lifecycle/                ← chat / prompt-only stream lifecycles
│   ├── listeners/                ← WebContents / Persistence / SSE / channel-adapter
│   ├── persistence/              ← MessageService / TemporaryChat backends
│   └── pipeStreamLoop.ts         ← shared chunk-pipe primitive
├── provider/                     ← provider config, endpoint resolution, custom providers
│   ├── custom/                   ← provider-specific adapters, transports, and wire profiles
│   ├── config.ts                 ← providerToAiSdkConfig (builder table)
│   ├── endpoint.ts               ← resolveEffectiveEndpoint + adapterFamily routing
│   ├── extensions.ts             ← ProviderExtension registrations
│   └── listModels.ts             ← per-provider model listing
├── mcp/                          ← McpRuntimeService / McpCatalogService, oauth/, built-in servers
│   └── servers/                  ← in-memory MCP server implementations (browser, filesystem)
├── skills/                       ← SkillService, SkillInstaller
├── contextBuild/                 ← context-window policy, compression, persisted tool output
├── localModel/                   ← local model catalog, acquisition, installation, capability workers
├── tokens/                       ← token estimation and modality profiles
├── tools/                        ← unified tool registry
│   └── adapters/
│       ├── aiSdk/                ← registry.ts, repair.ts; builtin/ (web_search/web_fetch/kb_*),
│       │                            mcp/ (server → ToolEntry sync), meta/ (tool_search/inspect/invoke;
│       │                            tool_exec defined but not injected), exposition/ (shouldDefer + applyDefer)
│       └── claudeCode/           ← agentTools.ts (registry → Claude Code runtime)
├── observability/                ← AI trace adapters (aiSdk / claudeCode), local projection, sinks
├── messages/                     ← UI part → AI SDK part conversion
├── types/                        ← AppProviderId, merged extension types, request types
└── utils/                        ← reasoning / model parameters / options / websearch helpers
```

## How a chat turn flows

1. Renderer `useChat({ transport: IpcChatTransport })` calls `sendMessages` →
   IpcApi `ai.stream.open` (`{ topicId, trigger, userMessageParts,
   parentAnchorId?, mentionedModelIds? }`).
2. The thin handler in `src/main/ipc/handlers/ai.ts` resolves the caller's
   `WebContents`, wraps it in a `WebContentsListener`, and delegates to
   `AiStreamManager.dispatch`. Stream state stays in the manager; transport
   registration stays in IpcApi.
3. `dispatchStreamRequest` picks the first `ChatContextProvider` whose
   `canHandle(topicId)` matches (persistent chat / temporary / agent
   session) and calls `prepareDispatch` — that resolves models, persists
   the user message, builds listeners, and returns a `PreparedDispatch`.
4. `AiStreamManager.send(input)` **starts** a turn (no active stream): creates
   an `ActiveStream`, launches one `StreamExecution` per model. (A chat
   resubmit on a live topic is persisted + queued as a steer and takes the
   **inject** path — the running turn yields and `onExecutionDone` chains a
   continuation; an agent-session follow-up also injects, upserting listeners.)
5. Each execution's `runExecutionLoop` calls `AiService.streamText(request,
   signal)`, which builds params (`buildAgentParams`) and constructs an `Agent`
   composing hooks from `RequestFeature[]` (anthropic cache, gateway usage
   normalisation, reasoning extraction, …), then calls `agent.stream(messages,
   signal)` to open the AI SDK stream and yield `UIMessageChunk`s.
   Agent-session runtime requests are the exception: `AiService.streamText`
   routes them to `AgentSessionRuntimeService.openTurnStream()` so the
   registered driver can own the concrete agent runtime.
6. `pipeStreamLoop` tees the chunk stream: one branch broadcasts to listeners
   (WebContents / SSE / channel-adapter / persistence), one branch runs
   `readUIMessageStream` to accumulate a `CherryUIMessage` snapshot.
7. On terminal (done / error / aborted / paused-for-approval), listeners get
   a typed terminal callback. `PersistenceListener` writes the final
   message via the appropriate `PersistenceBackend`.
8. Renderer reads the persisted row through `useQuery('/topics/:topicId/messages')`
   and disposes its overlay.

## Key invariants

- **Topic-level addressing.** Every IPC and broadcast is keyed by `topicId`.
  A topic has at most one active stream; subscribers are equal — there's no
  "owner" window.
- **Main owns persistence.** Renderer closing or crashing does not abort the
  stream and does not lose data — `PersistenceListener` writes on terminal
  regardless of who is listening.
- **Tool approval is Main-authoritative.** The renderer never writes
  `approved`/`denied` parts. It posts the decision over IPC and re-reads the
  authoritative row. See [Tool Approval](./tool-approval.md).
- **Adapter family per endpoint, not per provider.** Multi-endpoint relays
  (MiniMax, Silicon, AiHubMix, …) carry one `adapterFamily` per endpoint.
  Picking the SDK package never reads `apiHost` or provider id heuristics
  at request time. See [Adapter Family](./adapter-family.md).
- **One provider fact, one owner.** Host facts live on registry providers,
  protocol deviations on endpoint configs, user connection deltas on provider
  rows, and per-request choices on assistants. See
  [Provider State Ownership](./provider-state-ownership.md).

## Related references

- [Service Lifecycle](../lifecycle/README.md) — `AiService` extends `BaseService`
- [Data Layer](../data/README.md) — `MessageService`, `ModelService`,
  `ProviderService` (called from main-side AI code)
- [Window Manager](../window-manager/README.md) — `WebContentsListener`
  attaches to whatever windows are open
