# Tool Registry — Reviewer Cluster

## Scope

| Subpath | Files | Role |
|---|---|---|
| `src/main/ai/tools/` | `registry.ts` (109), `types.ts` (69), `context.ts` (76), `repair.ts` (79) | Catalog + per-request context + invalid-call repair |
| `tools/builtin/` | `KnowledgeListTool.ts`, `KnowledgeSearchTool.ts`, `WebSearchTool.ts`, `index.ts` | Built-in tool implementations + registration |
| `tools/mcp/` | `mcpTools.ts` (169), `resolveAssistantMcpTools.ts`, `utils.ts` | MCP server → ToolEntry sync, assistant resolution |
| `tools/meta/` | `toolSearch.ts`, `toolInspect.ts`, `toolInvoke.ts`, `toolExec.ts`, `formatJsDoc.ts`, `exec/runtime.ts` (205), `exec/worker.ts` (139) | Meta-tools surfaced on the defer path |
| `tools/exposition/` | `shouldDefer.ts` (89), `applyDeferExposition.ts` (56) | Defer policy + exposition |
| Tests | `__tests__/` across all subpaths | Per-file coverage (~25 test files total) |

## Intent

v1's tool surface was three disconnected systems: MCP transport in
`@main/mcpServers`, built-in tools wired by hand in `ApiService`, and
ad-hoc "agent" tools in `hub/format.ts`. v2 collapses all three into a
single `ToolRegistry` declared once + queried per-request, with meta-
tools that surface a search-then-call interface for large catalogs.

## Key changes

### `ToolEntry` model

```ts
interface ToolEntry {
  name: string         // wire-name, what the LLM emits
  namespace: string    // grouping for tool_search (web, kb, mcp:<id>, meta)
  description: string  // one-line summary for tool_search
  defer: 'never' | 'always' | 'auto'
  tool: Tool           // AI SDK Tool (schema + execute + needsApproval + toModelOutput)
  applies?(scope): boolean
}
```

Built-in / MCP / meta-tool entries share the same interface. AI SDK's
`Tool` semantics flow through unchanged.

### Singleton + per-test fresh

`registry` (`tools/registry.ts`) is a module-level singleton — tools
register at import time. Tests construct their own
`new ToolRegistry()`; see memory:
[No module-level state in shared test mocks](../../../).

### MCP sync — scoped (perf gate)

`syncMcpToolsToRegistry({ selectedToolIds })` only calls `listTools` on
the MCP servers that own at least one selected tool. Without that gate
every active server would be hit per request. See
`tools/mcp/mcpTools.ts` + commit `af7e4f854 perf(mcp-tools): scope
registry sync to selected servers`.

### Defer exposition (perf gate)

`shouldDefer(entries, contextWindow)` (commit `3c533aae6 perf(ai-tools):
gate defer exposition on net savings + model capability`) layers three
gates above the simple "auto pool ÷ context-window threshold":

1. `MIN_AUTO_DEFER_COUNT` — auto pool must be large enough that
   search-then-invoke beats inlining.
2. `META_TOOLS_OVERHEAD_TOKENS` — estimated savings must exceed the
   meta-tools' static prompt cost (`tool_search`, `tool_inspect`,
   `tool_invoke` descriptions + schemas + the `<DEFERRED_TOOLS>` system
   section).
3. Model capability check — non-function-calling models that aren't in
   prompt-tool-use mode bypass the entire defer path.

`applyDeferExposition(tools, registry, contextWindow)`:

- Strips deferred names from `tools`.
- Injects `tool_search` / `tool_inspect` / `tool_invoke`.
- Returns `deferredEntries` for the `<DEFERRED_TOOLS>` system-prompt
  section.

`tool_exec` is opt-in (assistant setting `metaTools.exec`) because it
runs arbitrary JS in a Node worker.

### Meta-tools

| Tool | Purpose | Notes |
|---|---|---|
| `tool_search` | Browse the deferred pool by namespace + query | Returns brief descriptions for each match |
| `tool_inspect` | JSDoc stub for one tool — schemas + descriptions | Model copies into `tool_exec` body or reads before `tool_invoke` |
| `tool_invoke` | Invoke any registry tool by name with JSON args | Plain delegation to the entry's `tool.execute` |
| `tool_exec` | Sandboxed JS exec with the full registry as global API | `runtime.ts` + `worker.ts`; uses `child_process.fork` |

### Tool-call repair

`createAiRepair({ providerId, providerSettings, modelId })` returns AI
SDK's `repairToolCall` function. When the model emits an unknown tool
name or unparseable args, the repair function gets one chance to fix it
via a follow-up LLM call. The repair model defaults to the same model;
override via a future Preference.

## Invariants

- `name` is unique across the registry — registering the same name
  overwrites; this is fine for MCP resync but never legitimate for
  built-in / meta tools.
- `applies` predicates are pure and synchronous; errors are caught
  with a "treating as inactive" warning.
- `defer: 'auto'` decisions can flip between requests — same tool can
  be inline in one request and deferred in another (context window
  changes, tool count changes).
- MCP sync is per-request and idempotent — never carry state across
  requests beyond the registry itself.

## Validation

- `__tests__/registry.test.ts` (167)
- `__tests__/repair.test.ts` (94)
- `__tests__/context.test.ts` (38)
- `builtin/__tests__/` (KnowledgeList, KnowledgeSearch, WebSearch — each ~150–360 cases)
- `mcp/__tests__/sync.test.ts` (239) + `utils.test.ts` (118)
- `meta/__tests__/toolInvoke.test.ts` (89) + `toolSearch.test.ts` (102)
- `exposition/__tests__/applyDeferExposition.test.ts` (96) + `shouldDefer.test.ts` (115)

## Follow-ups (out of scope)

- `tool_exec` sandboxing currently uses Node `child_process.fork` with
  CPU/memory limits but no syscall sandbox. A future hardening pass
  could move to `vm2` or a container.
- `formatJsDoc.ts` is shared between `tool_inspect` (Main) and any
  future renderer doc viewer; consider lifting to `@shared` if a
  consumer appears.
