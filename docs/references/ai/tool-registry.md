---
description: Unified aiSdk ToolEntry registry — built-in web/kb tools, MCP sync, native Tool Search, Core Code Mode, and deferred exposition
sources:
  - src/main/ai/tools/adapters/aiSdk
  - src/main/ai/tools/adapters/claudeCode/agentTools.ts
---

# Tool Registry

## Model

```ts
interface ToolEntry {
  name: string         // wire-name, what the LLM emits in tool_calls
  namespace: string    // ownership key (web, kb, mcp:<serverId>, meta) — never shown to the model
  namespaceLabel?: string // searchable namespace label; defaults to `namespace`
  description: string  // one-line summary for `tool_search`
  defer: 'never' | 'always' | 'auto'
  tool: Tool           // AI SDK Tool (schema + execute + needsApproval + toModelOutput)
  applies?(scope): boolean
}
```

`registry` (`src/main/ai/tools/adapters/aiSdk/registry.ts`) is a
process-wide singleton. `AiService.onInit()` calls the single
`registerBuiltinTools()` entry point; request preparation later reads the
registry through `buildAgentParams`. Agent-session runtimes build their own
runtime-native tool surfaces. For example,
`tools/adapters/claudeCode/agentTools.ts` combines Claude descriptors with MCP
tools and does not consume this AI SDK `ToolRegistry`.

Tests construct their own `new ToolRegistry()` to avoid singleton pollution.

## Wire-name convention

Double underscore is the segment separator (so internal single `_` stays
unambiguous):

| Source | Name pattern | Example |
|---|---|---|
| Built-in | fixed wire name (`<namespace>_<verb>`) | `web_search`, `kb_search` |
| MCP (AI SDK) | `mcp__<server-slug>__<tool-slug>_<identity-digest>` | `mcp__gmail__sendMessage_a1b2c3d4e5f60718293a` |
| Discovery / composition | SDK-native names | `tool_search`, `code_mode` |

The built-in wire names live in `@shared/ai/builtinTools` (single-underscore,
e.g. `web_search`); they are not derived from a `__` segment convention like MCP.
The AI SDK MCP digest is derived from the stable server id plus the original
protocol tool name. The readable slugs romanize Han characters (`tiny-pinyin`)
so CJK names still produce a meaningful segment; kana and Hangul do not
romanize and fall back to `server` / `tool` plus the digest. Claude Code keeps
its separate runtime naming contract.

## Built-in tools

`src/main/ai/tools/adapters/aiSdk/builtin/` currently registers **eleven**
entries:

| Namespace | Tools | Current gate |
|---|---|---|
| `web` | `web_search`, `web_fetch` | Selected client-side web routes |
| `kb` | `kb_list`, `kb_search`, `kb_read`, `kb_manage` | At least one in-scope knowledge base |
| `file` | `read_file` | First-party conversation attachments exist |
| `fs` | `fs_read` | Persisted/offloaded tool output can be read back |
| `mcp_resource` | `mcp_resource_list`, `mcp_resource_read` | An in-scope MCP resource server exists |
| `image` | `generate_image` | Assistant opt-in plus a configured painting model |

Registration happens in `builtin/registerBuiltinTools.ts` (`registerBuiltinTools`). Each
tool's `applies` predicate gates it on the current request scope; the gate is
not limited to assistant settings.

## MCP tools

`src/main/ai/tools/adapters/aiSdk/mcp/`:

- `resolveAssistantMcpToolIds` — assistant's enabled MCP servers + per-tool
  disable list → set of tool ids.
- `mcpTools.syncMcpToolsToRegistry({ selectedToolIds })` — scans active servers'
  cache-only catalogs via `McpCatalogService.listTools`, matches full tool ids,
  and registers only exact selections as `ToolEntry` objects whose
  `tool.execute` proxies through the MCP transport. The scan stops early once
  every selected id has been claimed. Ownership uses the stable
  `namespace: mcp:<serverId>`; display names never determine it, and
  `namespaceLabel: mcp:<serverName>` remains searchable and appears in the
  deferred namespace inventory. Because reads are last-known-good cache snapshots, a transient
  catalog failure does not evict a still-active server's prior entries.

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

## Native search and Code Mode

`applyDeferExposition` keeps the request-selected tools and marks deferred ones with
`deferLoading: true`. The SDK binds `tool_search` for each generation. A nonempty query
matches names, descriptions, and namespace labels by case-insensitive substring, including
Chinese text. Results contain `{ tools: [{ name, description }] }`, with at most five matches;
an exact name sorts first. Search only receives the SDK's eligible candidates.

Discovered schemas become callable on the **next model step**. A program cannot search and
invoke a previously unavailable tool in the same step. Native dispatch validates inputs and
preserves defaults, transforms, and `toModelOutput`. The old inspect/invoke ledger and live
executors are removed; historical `tool_inspect`, `tool_invoke`, and `tool_exec` cards remain readable.

`shouldDefer` preserves the existing `never` / `always` / `auto` policy: automatic deferral
requires at least five candidates, an estimated cost above 10% of the context window, and
savings above the conservative 500-token discovery allowance. A caller-provided `tool_search`
keeps its own dispatch and suppresses automatic deferral. Caller overrides of registered
names retain their own definitions.

`runtime/aiSdk/codeMode.ts` exposes `code_mode` using `@ai-sdk/code-mode`, native
`experimental_toolCallers`, and conversation catalogs. Eligible host tools remain directly
callable as well. Client-only tools, provider tools, and tools declaring approval requirements
stay outside Code Mode. Forced-approval MCP tools stay inline; the native approval card remains
authoritative. At execution, MCP tools recheck server activity, per-tool disablement, and new
approval requirements; stale discovery cannot grant access. See [Tool Approval](./tool-approval.md).

The package patch adds validated per-tool context, attributed child execution events, and a
raw-output projection hook. Cherry records child calls/results in the existing message stream,
retaining MCP metadata, images, and resources. Binary MCP content becomes a text placeholder
inside the sandbox; raw content remains in the child result. Model-supported screenshot media
is routed into subsequent model steps. Trusted local terminal failures stop the loop even when
a program discards their return value. Cancellation stops further dispatch; a host operation
that ignores its abort signal may still finish its already-started external work.

The engine is QuickJS from the pinned `run` production dependency. Each program has a 30-second
timeout, 64 MiB heap, 2 MiB stack, 256 KiB source limit, 1 MiB result/input limits, 64 KiB console
limit, 4 MiB per-tool bridge output limit, 256 host calls, and 32 concurrent calls. Code uses
`await tools.<name>(input)` and an explicit `return`; Node globals and arbitrary host filesystem
or network access are unavailable. No durable continuation or nested approval workflow is enabled.
The model is instructed to use direct calls for long operations such as image generation/editing.
Built-in host tools combine the program and request cancellation signals; completed child effects
are retained after a program fails and must not be blindly repeated.

Pi retains its native `codemode`, `tool_search`, and MCP extensions; see
[Pi code mode](./agent-session-runtime.md#pi-code-mode).

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
  `runtime/aiSdk/__tests__/codeMode.test.ts`
- Defer rationale, gate thresholds:
  `tools/adapters/aiSdk/exposition/shouldDefer.ts` (header doc + tests)
- Approval flow: [Tool Approval](./tool-approval.md)
