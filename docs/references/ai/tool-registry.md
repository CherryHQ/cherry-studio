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

`registry` (`src/main/ai/tools/registry.ts`) is a process-wide singleton.
Tool files register at module-import time; the registry is read at
request time by `buildAgentParams`.

Tests construct their own `new ToolRegistry()` to avoid singleton pollution.

## Wire-name convention

Double underscore is the segment separator (so internal single `_` stays
unambiguous):

| Source | Name pattern | Example |
|---|---|---|
| Built-in | `<namespace>__<verb>` | `web__search`, `kb__search` |
| MCP | `mcp__<serverId>__<toolName>` | `mcp__gmail__send_message` |
| Meta | `tool_<verb>` | `tool_search`, `tool_invoke`, `tool_inspect`, `tool_exec` |

## Built-in tools

`src/main/ai/tools/builtin/`:

- `WebSearchTool` — registered under namespace `web`. Talks to the
  configured web-search provider via the renderer-shared search service.
- `KnowledgeSearchTool` — semantic search over the active knowledge base.
- `KnowledgeListTool` — enumerate available knowledge bases / documents.

Registration happens in `builtin/index.ts`. Each tool's `applies` gates on
the relevant `assistant.settings.*` flag (e.g. `enableWebSearch`).

## MCP tools

`src/main/ai/tools/mcp/`:

- `resolveAssistantMcpTools` — assistant's enabled MCP servers + per-tool
  disable list → set of tool ids.
- `mcpTools.syncMcpToolsToRegistry({ selectedToolIds })` — calls
  `listTools` on each MCP server that owns at least one selected tool,
  registers each as a `ToolEntry` whose `tool.execute` proxies through
  the MCP transport. **Scope:** only servers owning a selected tool are
  hit — avoids paying the per-server round-trip when only one MCP tool
  is in use for this request.

The sync is idempotent; a stale entry is overwritten on the next sync.

## Meta-tools

`src/main/ai/tools/meta/` exposes four tools that turn the registry into
a search-then-call interface for the model:

| Tool | Use |
|---|---|
| `tool_search` | Browse the deferred pool by namespace + query, returns brief descriptions |
| `tool_inspect` | Emit a JSDoc stub for one tool — enough to call it correctly |
| `tool_invoke` | Invoke any registry tool by name with a JSON arg blob |
| `tool_exec` | Sandboxed JS exec with the full registry as a global API (`runtime.ts`, `worker.ts`) |

These are injected into the tool set by `applyDeferExposition` when (and
only when) the request actually defers tools. See below.

## Defer exposition

`src/main/ai/tools/exposition/`:

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

`tool_exec` is a higher-tier opt-in (only registered when the assistant
enables `metaTools.exec`) because it can run any tool combination in a
sandbox.

## `applies` and tool-call repair

- `applies(scope: ToolApplyScope)` — per-entry predicate consulted at
  `registry.selectActive`. Throws are caught and treated as "inactive"
  with a warning log.
- `createAiRepair(...)` (`tools/repair.ts`) — passed to AI SDK as
  `repairToolCall`. When the model emits an unknown tool name or
  malformed args, the repair function gets one chance to fix it via a
  follow-up LLM call.

## Where to read more

- Code: `src/main/ai/tools/`
- Tests: `tools/__tests__/`, `tools/builtin/__tests__/`,
  `tools/exposition/__tests__/`, `tools/mcp/__tests__/`,
  `tools/meta/__tests__/`
- Defer rationale, gate thresholds:
  `tools/exposition/shouldDefer.ts` (header doc + tests)
- Approval flow: [Tool Approval](./tool-approval.md)
