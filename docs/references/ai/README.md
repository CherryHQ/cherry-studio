# AI Reference

This is the entry point for the AI pipeline in Cherry Studio v2 — the
main-process service that owns every LLM call (chat streams, agent loops,
translate, summarisation) and the renderer-side transport that connects to it.

## Quick navigation

### Top-level architecture

| Document | What it covers |
|---|---|
| [Core Architecture](./core-architecture.md) | End-to-end call flow: `Ai_Stream_Open` IPC → context provider → AiStreamManager → Agent loop → `@ai-sdk/*` → broadcast / persist |
| [Stream Manager](./stream-manager.md) | Active-stream registry, listeners, reconnect, abort, mid-stream injection, persistence backends |
| [Agent Session Runtime](./agent-session-runtime.md) | Agent-session host/driver split, pending queue injection, resume token persistence, Claude Code driver fallback |
| [Adapter Family](./adapter-family.md) | How `provider.endpointConfigs[ep].adapterFamily` picks the right `@ai-sdk/*` package per request |

### Subsystems

| Document | What it covers |
|---|---|
| [Agent Loop](./agent-loop.md) | Main-process `Agent.stream()`: pendingMessages queue, hook composition, observer pattern, error/abort semantics |
| [Params Pipeline](./params-pipeline.md) | `buildAgentParams` + `RequestFeature` model: how capabilities, plugins, tools, and provider-specific quirks are composed |
| [Tool Registry](./tool-registry.md) | Built-in tools (knowledge / web search), MCP tools, meta-tools (`tool_search` / `tool_inspect` / `tool_invoke` / `tool_exec`), deferred exposition |
| [Provider Resolution](./provider-resolution.md) | `Provider.endpointConfigs` schema, endpoint resolution chain, variant suffixes, custom provider extensions (aihubmix, newapi) |
| [Trace / Telemetry](./trace.md) | `AiSdkSpanAdapter`, root span propagation, OTel attribute shape, what each span captures |
| [CherryClaw Overview](./cherryclaw/overview.md) | Autonomous agent architecture, memory system, and MCP surface |
| [CherryClaw Channels](./cherryclaw/channels.md) | IM channel adapters, routing, batching, and streaming bridge |
| [CherryClaw MCP Server](./cherryclaw/mcp-claw.md) | Built-in MCP tools for cron, notifications, skills, memory, and config |
| [CherryClaw Scheduler](./cherryclaw/scheduler.md) | Task-based polling scheduler for autonomous runs |

### Renderer-side glue

| Document | What it covers |
|---|---|
| [IPC Transport](./ipc-transport.md) | `useChat` + `IpcChatTransport`: `sendMessages` / `reconnect` / `cancel`, dispatch coordinator, topic-status mirror |
| [Execution Overlay](./execution-overlay.md) | `TopicStreamSubscription` + `useExecutionOverlay`: ref-counted attach, per-execution demux, one-shot `readUIMessageStream` per turn (the renderer half of the same merge function Main uses) |
| [Tool Approval](./tool-approval.md) | Approval registry, Main-as-writer model, persistent decisions, `useToolApproval` hook |

## Where the code lives

```
src/main/ai/
├── AiService.ts                  ← lifecycle owner, IPC handlers, dispatch entry
├── runtime/                      ← AI execution backends
│   ├── ai-sdk/                   ← Agent class, loop, observers, params/features
│   └── claude-code/              ← Claude Code driver, warm query, SDK adapter
├── agent-session/                ← agent-session topic host
│   └── AgentSessionRuntimeService.ts
├── stream-manager/               ← AiStreamManager + listeners + persistence backends
│   ├── AiStreamManager.ts
│   ├── context/                  ← ChatContextProvider implementations
│   ├── lifecycle/                ← chat / prompt-only stream lifecycles
│   ├── listeners/                ← WebContents / Persistence / SSE / channel-adapter
│   ├── persistence/              ← MessageService / TemporaryChat / AgentMessage / Translation backends
│   └── pipeStreamLoop.ts         ← shared chunk-pipe primitive
├── provider/                     ← provider config, endpoint resolution, custom providers
│   ├── custom/                   ← aihubmix, newapi
│   ├── config.ts                 ← providerToAiSdkConfig
│   ├── endpoint.ts               ← resolveEffectiveEndpoint + adapterFamily routing
│   ├── extensions/               ← ProviderExtension registrations
│   └── listModels.ts             ← per-provider model listing
├── mcp/                          ← MCP runtime/catalog services and built-in servers
│   └── servers/                  ← in-memory MCP server implementations
├── tools/                        ← unified tool registry
│   ├── builtin/                  ← KnowledgeSearch / KnowledgeList / WebSearch
│   ├── mcp/                      ← MCP server → ToolEntry sync
│   ├── meta/                     ← tool_search / tool_inspect / tool_invoke / tool_exec
│   ├── exposition/               ← shouldDefer + applyDeferExposition
│   ├── registry.ts
│   └── repair.ts                 ← invalid tool-call repair
├── observability/                ← AI trace adapters, local projection, sinks
├── messages/                     ← UI part → AI SDK part conversion
├── prompts/                      ← static prompt fragments
├── types/                        ← AppProviderId, merged extension types, request types
└── utils/                        ← reasoning / model parameters / options / websearch helpers
```

## How a chat turn flows

1. Renderer `useChat({ transport: IpcChatTransport })` calls `sendMessages` →
   IPC `Ai_Stream_Open` (`{ topicId, parts, parentAnchorId, models }`).
2. `AiService.ipcHandle('Ai_Stream_Open')` calls
   `dispatchStreamRequest(manager, request)`.
3. `dispatchStreamRequest` picks the first `ChatContextProvider` whose
   `canHandle(topicId)` matches (persistent chat / temporary / agent
   session) and calls `prepareDispatch` — that resolves models, persists
   the user message, builds listeners, and returns a `PreparedDispatch`.
4. `AiStreamManager.send(input)` either **injects** (running stream) or
   **starts** (no active stream): creates an `ActiveStream`, launches one
   `StreamExecution` per model.
5. Each execution calls `Agent.stream(buildAgentParams(...))`. `Agent.stream`
   composes hooks from `RequestFeature[]` (anthropic cache, gateway usage
   normalisation, reasoning extraction, …), opens the AI SDK stream, and
   yields `UIMessageChunk`s.
   Agent-session runtime requests are the exception: `AiService.streamText`
   routes them to `AgentSessionRuntimeService.openTurnStream()` so the
   registered driver can own the concrete agent runtime.
6. `pipeStreamLoop` tees the chunk stream: one branch broadcasts to listeners
   (WebContents / SSE / channel-adapter / persistence), one branch runs
   `readUIMessageStream` to accumulate a `CherryUIMessage` snapshot.
7. On terminal (done / error / aborted / paused-for-approval), listeners get
   a typed terminal callback. `PersistenceListener` writes the final
   message via the appropriate `PersistenceBackend`.
8. Renderer reads the persisted row through `useQuery('/topics/:id/messages')`
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

## Related references

- [Service Lifecycle](../lifecycle/README.md) — `AiService` extends `BaseService`
- [Data Layer](../data/README.md) — `MessageService`, `ModelService`,
  `ProviderService` (called from main-side AI code)
- [Messaging](../messaging/message-system.md) — `CherryMessagePart`,
  `CherryUIMessage`, parts model
- [Window Manager](../window-manager/README.md) — `WebContentsListener`
  attaches to whatever windows are open

## v2 refactor

The AI domain is the largest single area of the v2 refactor: the renderer
`src/renderer/src/aiCore/` tree is fully deleted, with logic ported into
`src/main/ai/`. Reviewer-facing change-cluster docs live in
[`v2-refactor-temp/docs/ai/`](../../../v2-refactor-temp/docs/ai/) — one
document per reviewable cluster, intended to be picked up by separate
review agents in parallel.
