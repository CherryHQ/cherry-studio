import type { Assistant } from '@shared/data/types/assistant'
import type { ImageGenerationSupport, UniqueModelId } from '@shared/data/types/model'
import type { Tool } from 'ai'

/**
 * Read-only context for `ToolEntry.applies`. Lives here so the tool
 * layer doesn't depend on the request pipeline; `RequestScope` extends
 * this shape.
 */
export interface ToolApplyScope {
  readonly assistant?: Assistant
  /** Painting model resolved once for this request; dynamic builtins derive their schema from it. */
  readonly paintingModel?: {
    readonly uniqueModelId: UniqueModelId
    readonly support: ImageGenerationSupport | null
  }
  /** Server allowlist + per-tool disable already applied. */
  readonly mcpToolIds: ReadonlySet<string>
  /** True when the request carries first-party file attachments — gates the `read_file` tool. Defaults to false. */
  readonly hasFileAttachments?: boolean
  /** True when the user has at least one knowledge base — gates the `kb_*` tools. Defaults to false. */
  readonly hasAnyKnowledgeBase?: boolean
  /**
   * Effective knowledge base scope for this request; see `resolveKnowledgeBaseIds`. Defaults to empty.
   */
  readonly knowledgeBaseIds?: readonly string[]
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
   *   builtin: 'cherry_web_search', 'cherry_web_fetch', 'cherry_kb_search'
   *   mcp:     'mcp__{camelCase(serverName)}__{camelCase(toolName)}' (see `buildFunctionCallToolName`)
   *   meta:    'cherry_tool_search', 'cherry_tool_inspect', 'cherry_tool_invoke', 'cherry_tool_exec'
   *
   * Double underscore is the segment separator so single `_` stays unambiguous.
   */
  name: string

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

  /** Materialize a request-scoped tool (for example, a model-specific input schema). */
  buildTool?(scope: ToolApplyScope): Tool

  applies?(scope: ToolApplyScope): boolean
}
