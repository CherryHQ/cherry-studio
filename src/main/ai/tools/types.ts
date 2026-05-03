import type { Assistant } from '@shared/data/types/assistant'
import type { Tool } from 'ai'

/**
 * Minimum read-only context a {@link ToolEntry.applies} predicate consults.
 * Lives here (and not in `agentParams/scope.ts`) so the tool layer doesn't
 * depend on the request-pipeline layer; `RequestScope` extends this shape.
 */
export interface ToolApplyScope {
  readonly assistant?: Assistant
  /** MCP tool ids this assistant has access to (server allowlist + per-tool disable applied). */
  readonly mcpToolIds: ReadonlySet<string>
}

/**
 * Whether a tool is exposed inline to the LLM or hidden behind tool_search.
 *   'never'  – always inline.
 *   'always' – always deferred.
 *   'auto'   – inline when the total tokens of all 'auto' tools fit under the
 *              defer threshold (~10% of context window); otherwise deferred.
 */
export const ToolDefer = {
  Never: 'never',
  Always: 'always',
  Auto: 'auto'
} as const
export type ToolDefer = (typeof ToolDefer)[keyof typeof ToolDefer]

/**
 * Side-effect classification used by {@link ToolProfile} to gate tools for
 * sub-agents / plan mode / etc. Built-in tools self-declare; MCP tools default
 * to 'unknown' since Cherry can't introspect MCP server semantics.
 */
export const ToolCapability = {
  Read: 'read',
  Write: 'write',
  Compute: 'compute',
  Unknown: 'unknown'
} as const
export type ToolCapability = (typeof ToolCapability)[keyof typeof ToolCapability]

export const BuiltinToolNamespace = {
  Web: 'web',
  Kb: 'kb',
  Meta: 'meta'
} as const
export type BuiltinToolNamespace = (typeof BuiltinToolNamespace)[keyof typeof BuiltinToolNamespace]

export type McpToolNamespace = `mcp:${string}`
export type ToolNamespace = BuiltinToolNamespace | McpToolNamespace

export const MetaToolName = {
  Search: 'tool_search',
  Inspect: 'tool_inspect',
  Invoke: 'tool_invoke',
  Exec: 'tool_exec'
} as const
export type MetaToolName = (typeof MetaToolName)[keyof typeof MetaToolName]

/**
 * Single entry in the ToolRegistry. Combines AI SDK's `Tool` (schema +
 * execute + needsApproval + toModelOutput) with Cherry-side metadata
 * (namespace, defer policy, capability, availability check).
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
  namespace: ToolNamespace
  /** One-line summary surfaced by `tool_search` when the model browses the catalog. */
  description: string
  defer: ToolDefer
  capability?: ToolCapability
  tool: Tool
  applies?(scope: ToolApplyScope): boolean
}
