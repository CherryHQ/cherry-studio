import type { Tool } from 'ai'

/**
 * Whether a tool is exposed inline to the LLM or hidden behind tool_search.
 *
 *   'never'  – always inline. For high-frequency, high-utility tools where the
 *              extra search round-trip would just waste tokens.
 *   'always' – always deferred. For experimental tools, tools with very large
 *              schemas, or tools the user doesn't want surfaced unless asked.
 *   'auto'   – inline when the total tokens of all 'auto' tools fit under the
 *              defer threshold (~10% of context window); otherwise deferred.
 *              Default for MCP tools.
 */
export type ToolDefer = 'never' | 'always' | 'auto'

/**
 * Single entry in the ToolRegistry. Combines AI SDK's `Tool` (schema +
 * execute + needsApproval + toModelOutput) with Cherry-side metadata
 * (namespace, defer policy, availability check).
 *
 * Registered declaratively at module-import time (builtin tools) or via
 * event sync (MCP tools); never per-request.
 */
export interface ToolEntry {
  /**
   * Unique wire-name. The string the LLM sees and emits in tool_calls.
   *   builtin: 'web__search', 'web__fetch', 'kb__search'
   *   mcp:     'mcp__{serverId}__{toolName}'
   *   meta:    'tool_search', 'tool_invoke', 'exec'
   * Double underscore is the segment separator so internal `_` stays unambiguous.
   */
  name: string

  /**
   * Logical grouping used by `tool_search` to aggregate results. Not part of
   * the wire-name. Conventions:
   *   builtin: 'web', 'kb'
   *   mcp:     'mcp:{serverId}'
   *   meta:    'meta'  (excluded from search results)
   */
  namespace: string

  /**
   * One-line summary surfaced by `tool_search` when the model browses the
   * catalog. The full schema description lives on `tool.description` and is
   * what the LLM sees once the tool is loaded into context.
   */
  description: string

  /** Defer policy. See {@link ToolDefer}. */
  defer: ToolDefer

  /** AI SDK Tool (schema + execute + needsApproval + toModelOutput). */
  tool: Tool

  /**
   * Optional toolset-level availability check. Returning false hides the tool
   * from `getAll()` results without removing the entry — useful when an MCP
   * server is configured but its API key is missing, or a builtin tool's
   * provider preference isn't set.
   */
  isAvailable?: () => boolean | Promise<boolean>
}
