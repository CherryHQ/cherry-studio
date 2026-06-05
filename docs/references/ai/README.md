# AI Reference

This is the entry point for the AI pipeline in Cherry Studio v2 — the
main-process service that owns every LLM call (chat streams, agent loops,
translate, summarisation) and the renderer-side transport that connects to it.

## Quick navigation

### Top-level architecture

| Document | What it covers |
|---|---|
| [Core Architecture](./core-architecture.md) | End-to-end call flow: `Ai_Stream_Open` IPC → context provider → AiStreamManager → Agent loop → `@ai-sdk/*` → broadcast / persist |
| [Stream Manager](./stream-manager.md) | Active-stream registry, listeners, reconnect, abort, abort-and-restart steering, persistence backends |
| [Agent Session Runtime](./agent-session-runtime.md) | Agent-session host/driver split, `pendingTurns` follow-up queue, resume token persistence, Claude Code driver fallback |
| [Adapter Family](./adapter-family.md) | How `provider.endpointConfigs[ep].adapterFamily` picks the right `@ai-sdk/*` package per request |

### Subsystems

| Document | What it covers |
|---|---|
| [Agent Loop](./agent-loop.md) | Main-process `Agent.stream()`: single-pass stream, hook composition, observer pattern, error/abort semantics |
| [Params Pipeline](./params-pipeline.md) | `buildAgentParams` + `RequestFeature` model: how capabilities, plugins, tools, and provider-specific quirks are composed |
| [Tool Registry](./tool-registry.md) | Built-in tools (knowledge / web search), MCP tools, meta-tools (`tool_search` / `tool_inspect` / `tool_invoke` / `tool_exec`), deferred exposition |
| [Provider Resolution](./provider-resolution.md) | `Provider.endpointConfigs` schema, endpoint resolution chain, variant suffixes, custom provider extensions (aihubmix, newapi) |
| [Observability (trace / telemetry)](./observability.md) | `AiSdkSpanAdapter`, root span propagation, OTel attribute shape, local span projection, sinks |

### Renderer-side glue

| Document | What it covers |
|---|---|
| [IPC Transport](./ipc-transport.md) | `useChat` + `IpcChatTransport`: `sendMessages` / `reconnectToStream`, dispatch coordinator, topic-status mirror |
| [Execution Overlay](./execution-overlay.md) | `TopicStreamSubscription` + `useExecutionOverlay`: ref-counted attach, per-execution demux, one-shot `readUIMessageStream` per turn (the renderer half of the same merge function Main uses) |
| [Tool Approval](./tool-approval.md) | Approval registry, Main-as-writer model, persistent decisions, `useToolApproval` hook |

## Where the code lives

> **Scope of the focused docs.** The reference documents in this folder map
> the **chat / stream pipeline** (dispatch → stream manager → runtime →
> tools → persistence → renderer transport). The `agents/`, `channels/`,
> `skills/`, and `mcp/` subsystems are mapped in the tree below but do not
> yet have dedicated deep-dive docs.

```
src/main/ai/
├── AiService.ts                  ← lifecycle owner, IPC handlers (generate / translate / approval)
├── runtime/                      ← AI execution backends + runtime registry
│   ├── aiSdk/                    ← Agent class, loop, observers, params/features, prompts/
│   └── claudeCode/               ← Claude Code driver, warm query, SDK adapter
├── agentSession/                 ← agent-session topic host
│   └── AgentSessionRuntimeService.ts
├── agents/                       ← AgentJobsService, AgentTaskJobHandler, runAgentTask, builtin/, cherryclaw/
├── channels/                     ← ChannelManager + IM adapters (discord/feishu/qq/slack/telegram/wechat) + security/
├── streamManager/                ← AiStreamManager + listeners + persistence backends
│   ├── AiStreamManager.ts        ← registers the stream IPC (Open/Attach/Detach/Abort)
│   ├── context/                  ← ChatContextProvider implementations + dispatch
│   ├── lifecycle/                ← chat / prompt-only stream lifecycles
│   ├── listeners/                ← WebContents / Persistence / SSE / channel-adapter
│   ├── persistence/              ← MessageService / TemporaryChat / Translation backends
│   └── pipeStreamLoop.ts         ← shared chunk-pipe primitive
├── provider/                     ← provider config, endpoint resolution, custom providers
│   ├── custom/                   ← aihubmix, newapi
│   ├── config.ts                 ← providerToAiSdkConfig (builder table)
│   ├── endpoint.ts               ← resolveEffectiveEndpoint + adapterFamily routing
│   ├── extensions/               ← ProviderExtension registrations
│   └── listModels.ts             ← per-provider model listing
├── mcp/                          ← McpRuntimeService / McpCatalogService, oauth/, built-in servers
│   └── servers/                  ← in-memory MCP server implementations (browser, filesystem)
├── skills/                       ← SkillService, SkillInstaller
├── tools/                        ← unified tool registry
│   └── adapters/
│       ├── aiSdk/                ← registry.ts, repair.ts; builtin/ (web__search/web__fetch/kb__*),
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
   IPC `Ai_Stream_Open` (`{ topicId, trigger, userMessageParts, parentAnchorId?, mentionedModelIds? }`).
2. `AiStreamManager.onInit` registered the `Ai_Stream_Open` handler; it
   wraps the sender in a `WebContentsListener` and calls
   `dispatchStreamRequest(manager, subscriber, req)`. (The stream IPC —
   `Open`/`Attach`/`Detach`/`Abort` — lives on `AiStreamManager`, not
   `AiService`.)
3. `dispatchStreamRequest` picks the first `ChatContextProvider` whose
   `canHandle(topicId)` matches (persistent chat / temporary / agent
   session) and calls `prepareDispatch` — that resolves models, persists
   the user message, builds listeners, and returns a `PreparedDispatch`.
4. `AiStreamManager.send(input)` **starts** a turn (no active stream): creates
   an `ActiveStream`, launches one `StreamExecution` per model. (A chat
   resubmit on a live topic is restarted upstream — `dispatch` calls
   `abortAndAwait` first; only an agent-session follow-up takes the
   **inject** path, which just upserts listeners.)
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

The AI domain is the largest single area of the v2 refactor: the v1
renderer aiCore tree (formerly `src/renderer/src/aiCore/`, pre-v2 layout)
is fully deleted, with logic ported into `src/main/ai/`.

These reference docs are **self-contained** — they do not depend on the
throwaway `v2-refactor-temp/` tree. (The reviewer-facing change-cluster
narratives that live there are review logistics for the in-flight PR, and
are removed when the v2 AI refactor merges.)
