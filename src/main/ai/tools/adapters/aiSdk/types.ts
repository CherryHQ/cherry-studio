import type { Assistant } from '@shared/data/types/assistant'
import type { Tool } from 'ai'

/**
 * Read-only context for `ToolEntry.applies`. Lives here so the tool
 * layer doesn't depend on the request pipeline; `RequestScope` extends
 * this shape.
 */
export interface ToolApplyScope {
  readonly assistant?: Assistant
  /** Server allowlist + per-tool disable already applied. */
  readonly mcpToolIds: ReadonlySet<string>
}

/**
 *   'never'  — always inline.
 *   'always' — always deferred (experimental tool, huge schema, …).
 *   'auto'   — inline when the auto pool fits the defer threshold; default for MCP.
 */
export type ToolDefer = 'never' | 'always' | 'auto'

export interface ToolEntry {
  /**
   * Unique wire-name the LLM emits.
   *   builtin: 'web__search', 'web__fetch', 'kb__search'
   *   mcp:     'mcp__{camelCase(serverName)}__{camelCase(toolName)}' (see `buildFunctionCallToolName`)
   *   meta:    'tool_search', 'tool_invoke', 'exec'
   *
   * Double underscore is the segment separator so single `_` stays unambiguous.
   */
  name: string

  /**
   * Whether the context-build truncate/persist layer may rewrite this
   * tool's results. `false` exempts the tool (chef `perTool` preserve):
   *   - citation tools (kb__search, web__search) — truncation breaks the
   *     inline `[id]` anchors the model cites in its reply
   *   - read-style tools — persisting their output would route the model
   *     right back through the same tool to read the persisted file (loop)
   * Default (undefined) = truncatable.
   */
  truncatable?: boolean

  /**
   * Grouping for `tool_search`. NOT part of the wire-name.
   *   builtin: 'web', 'kb'
   *   mcp:     'mcp:{serverName}'  (raw display name, not camelCased)
   *   meta:    'meta'  (excluded from search results)
   */
  namespace: string

  /** One-line summary for `tool_search`. Full schema description lives on `tool.description`. */
  description: string

  defer: ToolDefer

  tool: Tool

  applies?(scope: ToolApplyScope): boolean
}
