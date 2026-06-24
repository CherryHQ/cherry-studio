# Tool Registry

## Model

```ts
interface ToolEntry {
  name: string         // wire-name, what the LLM emits in tool_calls
  namespace: string    // grouping for `tool_search` (web, kb, mcp:<id>, meta)
  description: string  // one-line summary for `tool_search`
  defer: 'never' | 'always' | 'auto'
  tool: Tool           // AI SDK Tool (schema + execute + needsApproval + toModelOutput)
  applies?(scope): boolean
}
```

`registry` (`src/main/ai/tools/adapters/aiSdk/registry.ts`) is a
process-wide singleton. Tool files register at module-import time; the
registry is read at request time by `buildAgentParams`. The Claude Code
runtime has a *separate* tool system — `tools/adapters/claudeCode/agentTools.ts`
builds its descriptors from MCP servers and built-in descriptors directly;
it does not consume this aiSdk `ToolRegistry`.

Tests construct their own `new ToolRegistry()` to avoid singleton pollution.

## Wire-name convention

Double underscore is the segment separator (so internal single `_` stays
unambiguous):

| Source | Name pattern | Example |
|---|---|---|
| Built-in | fixed wire name (`<namespace>_<verb>`) | `web_search`, `kb_search` |
| MCP | `mcp__<camelCase(server)>__<camelCase(tool)>` | `mcp__gmail__sendMessage` |
| Meta | `tool_<verb>` | `tool_search`, `tool_invoke`, `tool_inspect` (`tool_exec` is defined but not injected — see below) |

The built-in wire names live in `@shared/ai/builtinTools` (single-underscore,
e.g. `web_search`); they are not derived from a `__` segment convention like MCP.

## Built-in tools

`src/main/ai/tools/adapters/aiSdk/builtin/` registers **four** entries:

- `web_search` (`WebSearchTool.ts` → `createWebSearchToolEntry`) — namespace
  `web`. Talks to the configured web-search provider via the
  renderer-shared search service.
- `web_fetch` (`WebFetchTool.ts` → `createWebFetchToolEntry`) — namespace
  `web`. Fetches a URL's content.
- `kb_search` (`KnowledgeSearchTool.ts`) — semantic search over the active
  knowledge base.
- `kb_list` (`KnowledgeListTool.ts`) — enumerate available knowledge bases /
  documents.

Registration happens in `builtin/index.ts` (`registerBuiltinTools`). Each
tool's `applies` gates on the relevant `assistant.settings.*` flag (e.g.
`enableWebSearch`).

## MCP tools

`src/main/ai/tools/adapters/aiSdk/mcp/`:

- `resolveAssistantMcpToolIds` — assistant's enabled MCP servers + per-tool
  disable list → set of tool ids.
- `mcpTools.syncMcpToolsToRegistry({ selectedToolIds })` — reads each
  selected server's tools from the catalog via `McpCatalogService.listTools`
  (cache-only; see [Tool catalog reads](#tool-catalog-reads-never-block-on-mcp)),
  registers each as a `ToolEntry` whose `tool.execute` proxies through
  the MCP transport. **Scope:** only servers owning a selected tool are
  synced. Because the read is last-known-good cache, a server is only evicted
  from the registry when its cache is genuinely empty — a transient blip can no
  longer drop a still-active server's tools.

The sync is idempotent; a stale entry is overwritten on the next sync.

### Tool catalog reads never block on MCP

`McpCatalogService` splits the MCP tool catalog into a **read** facade and a
**write/refresh** path:

- **`listTools(serverId)`** is cache-only — it returns the shared
  `mcp.tools.<serverId>` cache and **never connects** to the upstream MCP server.
  Every hot path that builds an agent/chat's tool surface uses it: the Claude Code
  SDK bridge (`createSdkMcpServerInstance`), `buildMcpToolMetadata`, the agent
  tool-policy (`agentTools.listMcpDescriptors`), and the two AI-SDK adapters
  above. A dead or slow server therefore cannot block agent/chat startup
  (issue #16242).
- **`refreshTools(serverId)`** (and the private `listToolsForServer`) is the live
  path that connects, lists, and writes the cache. It is driven entirely by
  background warmers: `prewarmActiveServerTools` (at `onReady`), the
  `onToolListChanged` refresh, the renderer's on-demand `refreshTools` (via
  `useAgentTools`), the server-enable toggle, and `restartServer`.

`listTools` also fires a single non-blocking `refreshTools` the first time it sees
a never-warmed server (cache `undefined`, distinct from a warmed-but-empty `[]`),
so headless/cron starts self-warm without re-probing dead servers.

Trade-off: tool availability is **eventually consistent**. A server whose cache
is still cold when a session starts contributes no tools to that session and
appears on the next one — the Claude Agent SDK snapshots the tool list per
session, so this cannot be made live mid-session.

## Meta-tools

`src/main/ai/tools/adapters/aiSdk/meta/` defines four tools that turn the
registry into a search-then-call interface for the model. Only the first
three are injected:

| Tool | Injected? | Use |
|---|---|---|
| `tool_search` | yes | Browse the deferred pool by namespace + query, returns brief descriptions |
| `tool_inspect` | yes | Emit a JSDoc stub for one tool — enough to call it correctly |
| `tool_invoke` | yes | Invoke any registry tool by name with a JSON arg blob |
| `tool_exec` | **no** | Sandboxed JS exec with the full registry as a global API (`meta/exec/runtime.ts`, `meta/exec/worker.ts`) — defined but intentionally not injected |

The injected three are added to the tool set by `applyDeferExposition` when
(and only when) the request actually defers tools. See below.

## Defer exposition

`src/main/ai/tools/adapters/aiSdk/exposition/`:

- `shouldDefer(entries, contextWindow)` — returns the set of names to
  defer. Two gates above the simple threshold:
  - **MIN_AUTO_DEFER_COUNT** — the auto pool must be large enough that
    search-then-invoke beats inlining.
  - **META_TOOLS_OVERHEAD_TOKENS** — estimated savings must exceed the
    meta-tools' static prompt cost. Without these gates, small tool sets
    + small-context models trigger defer and pay net-negative tokens.

- `applyDeferExposition(tools, registry, contextWindow)` — strips the
  deferred names out of `tools`, injects `tool_search` / `tool_inspect` /
  `tool_invoke`, and returns the entries the system-prompt's
  `<DEFERRED_TOOLS>` section needs to enumerate (so the model knows what
  namespaces exist).

**Approval-gated tools are never deferred.** A force-prompt MCP tool is registered
with `defer: 'never'` — `mcp/mcpTools.ts` reads `isMcpToolForcePromptBySource` once
to drive both `defer` and `needsApproval` — so it stays inline and the SDK's native
approval gate fires on it. Deferring it would drop it from the SDK tool-set, so the
gate would never fire and it would be reachable only through `tool_invoke` with no
approval card. As a runtime backstop the `tool_invoke` / `tool_exec` meta-tools also
call `isApprovalGated` at execution time and refuse a gated tool (covering the
`registry.getByName(any-name)` vector), steering the model to call it inline. See
[Tool Approval](./tool-approval.md).

`tool_exec` is **not injected** by `applyDeferExposition` — there is no
`metaTools.exec` flag. The injection site (`applyDeferExposition.ts:50-53`)
deliberately leaves it out: its `worker_threads` + `new Function` sandbox
runs model-authored code with full Node privileges, a privilege-escalation
surface vs the renderer's prior restrictions. It is meant to be re-enabled
behind an explicit Preference key once there is a concrete need.

## `applies` and tool-call repair

- `applies(scope: ToolApplyScope)` — per-entry predicate consulted at
  `registry.selectActive`. Throws are caught and treated as "inactive"
  with a warning log.
- `createAiRepair(...)` (`tools/adapters/aiSdk/repair.ts`) — passed to AI SDK as
  `experimental_repairToolCall`. When the model emits **malformed args**
  (`InvalidToolInputError`), the repair function gets one chance to fix it via a
  follow-up LLM call. Other failures (e.g. an unknown tool name) are
  returned unrepaired.

## Where to read more

- Code: `src/main/ai/tools/adapters/aiSdk/` (Claude Code adapter:
  `src/main/ai/tools/adapters/claudeCode/`)
- Tests: `tools/adapters/aiSdk/__tests__/`,
  `tools/adapters/aiSdk/builtin/__tests__/`,
  `tools/adapters/aiSdk/exposition/__tests__/`,
  `tools/adapters/aiSdk/mcp/__tests__/`,
  `tools/adapters/aiSdk/meta/__tests__/`
- Defer rationale, gate thresholds:
  `tools/adapters/aiSdk/exposition/shouldDefer.ts` (header doc + tests)
- Approval flow: [Tool Approval](./tool-approval.md)
