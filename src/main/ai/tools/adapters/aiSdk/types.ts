import type { EntityToolOutputCodec } from '@cherrystudio/ai-core'
import type { Assistant } from '@shared/data/types/assistant'
import type { ImageGenerationSupport, UniqueModelId } from '@shared/data/types/model'
import type { WebToolRoutes } from '@shared/utils/provider'
import type { Tool } from 'ai'

/**
 * Main-side codec: the aiCore deflate/assemble pair plus the persist-lane
 * snippet policy (the inline stand-in for a blobbed content field).
 */
export interface ToolOutputCodec extends EntityToolOutputCodec {
  snippet(text: string): string
}

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
  /** True when the conversation already references persisted tool-output blobs — gates the `fs_read` tool. Defaults to false. */
  readonly hasPersistedOutputs?: boolean
  /** True when the context-build truncate lane can offload tool outputs this request — gates the `fs_read` tool. Defaults to false. */
  readonly canOffloadToolOutputs?: boolean
  /** True when the user has at least one knowledge base — gates the `kb_*` tools. Defaults to false. */
  readonly hasAnyKnowledgeBase?: boolean
  /**
   * Effective knowledge base scope for this request; see `resolveKnowledgeBaseScope`. Defaults to empty.
   */
  readonly knowledgeBaseIds?: readonly string[]
  /** The selected implementation for each mutually exclusive web capability. */
  readonly webToolRoutes?: WebToolRoutes
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
   *   builtin: 'web_search', 'web_fetch', 'kb_search'
   *   mcp:     'mcp__{serverSlug}__{toolSlug}_{identityDigest}'
   *   meta:    'tool_search', 'tool_inspect', 'tool_invoke', 'tool_exec'
   *
   * Double underscore is the segment separator so single `_` stays unambiguous.
   */
  name: string

  /**
   * Whether the context-build truncate/persist layer may rewrite this
   * tool's results. `false` exempts the tool (truncate `perTool` preserve):
   *   - citation tools (kb__search, web__search) — truncation breaks the
   *     inline `[id]` anchors the model cites in its reply
   *   - read-style tools — persisting their output would route the model
   *     right back through the same tool to read the persisted file (loop)
   * Default (undefined) = truncatable.
   *
   * Lane interplay with `codec`: in-flight, `truncatable: false` wins
   * unconditionally (fs_read's loop protection); at persist time a codec
   * makes the tool trimmable even with `truncatable: false` (echo trimming
   * is safe there — the live loop keeps seeing full content in-flight).
   */
  truncatable?: boolean

  /**
   * Structure-aware trimming codec (see `EntityToolOutputCodec`): trims only
   * per-entity content fields, never identity/citation skeletons. Preferred
   * over the blanket `truncatable: false` for citable tools. `snippet` is the
   * persist-lane policy for the inline stand-in of a blobbed content field
   * (~300 chars, byte-aligned with the renderer citation snippet).
   */
  codec?: ToolOutputCodec

  /**
   * Ownership key. NOT part of the wire-name, and never shown to the model.
   *   builtin: 'web', 'kb'
   *   mcp:     'mcp:{serverId}'  (stable ownership key, not a display name)
   *   meta:    'meta'  (excluded from search results)
   */
  namespace: string

  /**
   * What `tool_search` groups by and shows the model. Defaults to `namespace`;
   * set it when the namespace is an opaque id (MCP uses `mcp:{serverName}`).
   */
  namespaceLabel?: string

  /** One-line summary for `tool_search`. Full schema description lives on `tool.description`. */
  description: string

  defer: ToolDefer

  tool: Tool

  /** Materialize a request-scoped tool (for example, a model-specific input schema). */
  buildTool?(scope: ToolApplyScope): Tool

  applies?(scope: ToolApplyScope): boolean
}
