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
| [Core Architecture](./core-architecture.md) | End-to-end Conversation command/effect flow from IPC through history and execution ports |
| [Conversation Runtime](./conversation-runtime.md) | Unified Chat/Agent control owner, current ownership failure, trigger/effect matrix, resource boundaries |
| [Execution Resources](./stream-manager.md) | Provider and one-shot prompt resources below the Conversation owner |
| [Agent Session Runtime](./agent-session-runtime.md) | Agent-session host/driver split, follow-up admission, resume persistence, and the registered Claude Code, Pi, and DSH drivers |
| [Channel Runtime](./channel-runtime.md) | IM adapter connections, ingress lifecycle, live updates, terminal delivery, and connection-epoch fencing |
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
| [AI Usage Records](./ai-usage-records.md) | Best-effort per-provider-invocation usage/cost analytics: capture ownership, immutable attribution snapshots, message projection, bounded query API, migration, freshness |

### Renderer-side glue

| Document | What it covers |
|---|---|
| [IPC Transport](./ipc-transport.md) | `useChat` + `IpcChatTransport`: `sendMessages` / `reconnectToStream`, dispatch service, Conversation-status projection |
| [Execution Overlay](./execution-overlay.md) | `StreamAttachmentService` + `ConversationStreamSubscription` + `ExecutionStreamOverlayService`: observational attachment, exact execution demux, refresh-before-retire |
| [Tool Approval](./tool-approval.md) | Approval registry, Main-as-writer model, persistent decisions, `useToolApproval` hook |

## Where the code lives

> **Scope of the focused docs.** The reference documents in this folder map
> the **chat / stream pipeline** (dispatch → Conversation runtime → execution resource →
> tools → persistence → renderer transport). The `channels/`, `skills/`, and
> `mcp/` subsystems are mapped in the tree below; `skills/` and `mcp/` do not
> yet have dedicated deep-dive docs.

```
src/main/ai/
├── AiService.ts                  ← provider operations, built-in tool init, approval decisions
├── runtime/                      ← AI execution backends + agent-session runtime registry
│   ├── aiSdk/                    ← Agent class, loop, observers, params/features
│   ├── claudeCode/               ← Claude Code driver, warm query, SDK adapter
│   ├── pi/                       ← Pi runtime connection and approval extension
│   └── dsh/                      ← DeepSeek Harness runtime connection
├── conversation/                 ← Conversation owner, pure aggregate, execution resources
│   ├── ConversationRuntimeService.ts
│   ├── conversationState.ts
│   ├── AiExecutionManager.ts
│   └── PromptStreamManager.ts
├── agentSession/                 ← Agent driver resource and durable delivery adapters
│   ├── AgentConnectionManager.ts
│   └── AgentSessionDeliveryService.ts
├── agents/                       ← AgentJobsService, AgentTaskJobHandler, runAgentTask, prompt, heartbeat, builtin/
├── channels/                     ← connection, ingress, delivery, IM adapters, and output security
│   ├── ChannelManager.ts         ← adapter pool and connection-epoch authority
│   ├── ChannelIngressService.ts  ← lifecycle start, pause, and inbound drain
│   └── ChannelDeliveryService.ts ← live ownership, terminal FIFO/dedupe, block policy
├── streamManager/                ← history preparation adapters and output ports
│   ├── context/                  ← Chat/Agent HistoryPort adapters
│   ├── listeners/                ← WebContents / Persistence / SSE / channel-adapter
│   └── persistence/              ← MessageService / TemporaryChat / Translation backends
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
├── inference/                    ← local embedding/OCR inference workers and model sources
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

1. Renderer `IpcChatTransport.sendMessages` sends `ai.stream.open` with an exact
   `ConversationRef`, trigger, input parts, tree anchor, and model selection.
2. The IPC handler binds the caller's `WebContents` observer and submits the
   command to `ConversationRuntimeService`'s per-Conversation lane.
3. The admission actor validates without writes, previews the reducer transition
   with preallocated identities, and synchronously asks the Chat or Agent history
   adapter to commit the SQLite skeleton. Only after that durable boundary does
   the actor commit `TurnCommitted`, `InputCommitted`, or `StepCommitted` to
   its aggregate.
4. The committed aggregate emits `StartExecution`, which is executed by
   `AiExecutionManager`. Stateless Chat runs
   call `AiService.streamText`; stateful Agent runs delegate their driver
   resource to `AgentConnectionManager`. Neither resource admits or settles a
   logical turn.
5. Chunks stay on the data plane: listeners receive exact
   `ConversationRef + TurnId + ExecutionId + chunkSeq`, while
   `readUIMessageStream` accumulates the terminal snapshot.
6. First-chunk, interaction, start-failure, and terminal facts return to the
   same Conversation owner. The aggregate selects an immutable outcome and
   emits a persistence descriptor.
7. `ConversationTerminalPersistenceCoordinator` persists that descriptor and
   returns the exact result command. Only then does Main publish execution and
   turn terminal events; explicit Stop has the documented deferred-recovery
   escape.
8. At Conversation quiescence, the renderer refreshes SQLite/SWR before
   retiring the matching Turn's overlay. Old-turn callbacks cannot retire a
   newer Conversation binding.

## Key invariants

- **Exact Conversation addressing.** Control and stream events carry a
  `ConversationRef`; Agent Sessions are not encoded as synthetic Topic IDs.
- **One control owner per Conversation.** `ConversationActor` owns its aggregate,
  admission FIFO, committed inputs, Stop, interactions, terminal outcome,
  persistence completion, and quiescence. `ConversationRuntimeService` only
  routes IPC/results and composes global lifecycle barriers. Resource state
  never decides those facts.
- **Main owns persistence.** Renderer closing or crashing does not abort the
  execution. Attachment is observational; terminal persistence does not depend
  on a window listener.
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
