import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  DataUIPart,
  DynamicToolUIPart,
  FileUIPart,
  InferUIMessageChunk,
  ReasoningUIPart,
  TextUIPart,
  UIDataTypes,
  UIMessage,
  UIMessagePart,
  UITools
} from 'ai'
import * as z from 'zod'

import type { CherryDataPartTypes } from './uiParts'

/**
 * Message Statistics - combines token usage and performance metrics
 * Replaces the separate `usage` and `metrics` fields
 *
 * TODO(message-stats-redesign): This schema is flat, OpenAI-legacy-named, and
 * does not cover the actual modalities / billing dimensions we ship today.
 * Known gaps, to be addressed in a dedicated follow-up:
 *
 *  1. Naming drift vs AI SDK v5
 *     - `promptTokens` / `completionTokens` → should be `inputTokens` / `outputTokens`
 *     - `thoughtsTokens` is Gemini-only phrasing; AI SDK uses `reasoningTokens`
 *
 *  2. Cache accounting entirely missing
 *     - AI SDK `inputTokenDetails` has `noCacheTokens` / `cacheReadTokens` / `cacheWriteTokens`
 *     - Claude prompt caching and Gemini context caching are currently folded
 *       into a single `promptTokens`, so users can't see cache hit-rate or
 *       audit premium-rate cache writes
 *
 *  3. Output breakdown missing
 *     - AI SDK `outputTokenDetails` has `textTokens` / `reasoningTokens`;
 *       we only have a single `thoughtsTokens` patch
 *
 *  4. Non-text modalities not modelled
 *     - Embedding (single `tokens` field, no output concept)
 *     - Image generation (real billing is image count × size × quality, not tokens)
 *     - Audio (OpenAI audio tokens, Gemini per-second)
 *     - Video (Gemini, per-second or token-equivalent)
 *
 *  5. Cost auditability
 *     - Single `cost: number` loses per-bucket breakdown
 *     - No pricing snapshot — if provider pricing changes, historical
 *       stats drift. Need `{ costBreakdown, pricingSnapshot }` pair
 *
 * Target shape (draft):
 *   interface MessageStats {
 *     language?: LanguageUsage         // inputTokens, outputTokens, totalTokens,
 *                                      // inputBreakdown{noCache,cacheRead,cacheWrite},
 *                                      // outputBreakdown{text,reasoning}
 *     embedding?: EmbeddingUsage       // tokens, vectorCount
 *     image?: ImageUsage               // imageCount, size, quality, (tokens?)
 *     audio?: AudioUsage               // inputAmount/unit, outputAmount/unit
 *     video?: VideoUsage               // inputSeconds, (tokens?)
 *     timings?: { timeFirstTokenMs, timeCompletionMs, timeThinkingMs }
 *     cost?: number                    // aggregate
 *     costBreakdown?: Partial<Record<CostBucket, number>>
 *     pricingSnapshot?: { rates, capturedAt }
 *   }
 *
 * Redesign touches: renderer usage UI, DB column readers (old rows still
 * have promptTokens/completionTokens — need fallback), pricing subsystem,
 * V1/V2 migration. Tracked as a separate PR series so this layer isn't
 * rushed alongside stream-manager changes.
 */
export const MessageStatsSchema = z.strictObject({
  // Token consumption (from API response)
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  thoughtsTokens: z.number().optional(),

  // Cost (calculated at message completion time)
  cost: z.number().optional(),

  // Performance metrics (measured locally)
  timeFirstTokenMs: z.number().optional(),
  timeCompletionMs: z.number().optional(),
  timeThinkingMs: z.number().optional()
})
export type MessageStats = z.infer<typeof MessageStatsSchema>

// ============================================================================
// Message Data
// ============================================================================

/** Cherry-specific UIMessagePart with our custom DataUIPart types baked in. */
export type CherryMessagePart = UIMessagePart<CherryDataPartTypes, UITools>

/**
 * Message data field structure
 * This is the type for the `data` column in the message table.
 *
 * After v2 migration, messages are stored in `parts` format (AI SDK UIMessage.parts).
 * The `blocks` field is retained for type compatibility during migration but
 * should not be used for new messages.
 */
export interface MessageData {
  /** @deprecated Use `parts` for new messages. Retained for v1→v2 migration compatibility. */
  blocks?: MessageDataBlock[]
  /**
   * AI SDK UIMessage.parts format — the canonical storage format after v2 migration.
   *
   * Accepts `UIMessagePart[]` (the generic AI SDK type) for writes — the DB stores
   * whatever parts the AI SDK produces. Readers can narrow to `CherryMessagePart[]`
   * when they need Cherry-specific data part type safety.
   */
  parts?: CherryMessagePart[]
}

// ── Cherry-specific UI message types ────────────────────────────────

/**
 * Metadata carried on a streamed `CherryUIMessage`.
 *
 * These fields mirror the token columns on `MessageStats` so that once the
 * accumulator writes a snapshot into `exec.finalMessage.metadata`, the
 * persistence backend can translate it 1:1 into the DB `stats` column
 * without inventing extra plumbing. Keep the names aligned with the
 * legacy `MessageStats` shape (promptTokens / completionTokens / ...)
 * until the redesign tracked in `MessageStats` lands — the same names on
 * both sides make `statsFromMetadata()` a trivial projection.
 */
export interface CherryUIMessageMetadata {
  /** Total tokens reported by the provider (mirrors `MessageStats.totalTokens`). */
  totalTokens?: number
  /** Input / prompt tokens (AI SDK `inputTokens`, legacy `promptTokens`). */
  promptTokens?: number
  /** Output / completion tokens (AI SDK `outputTokens`, legacy `completionTokens`). */
  completionTokens?: number
  /**
   * Reasoning / thinking tokens — AI SDK `outputTokenDetails.reasoningTokens`
   * (Gemini thoughts, Anthropic extended thinking, OpenAI o-series).
   */
  thoughtsTokens?: number
  createdAt?: string
}

/** Cherry Studio's UIMessage with custom metadata and data part types. */
export type CherryUIMessage = UIMessage<CherryUIMessageMetadata, CherryDataPartTypes>

/** Cherry Studio's UIMessageChunk — inferred from CherryUIMessage. */
export type CherryUIMessageChunk = InferUIMessageChunk<CherryUIMessage>

// Re-export AI SDK part types for convenience
export type {
  DataUIPart,
  DynamicToolUIPart,
  FileUIPart,
  ReasoningUIPart,
  TextUIPart,
  UIDataTypes,
  UIMessage,
  UIMessagePart,
  UITools
}

//FIXME [v2] 注意，以下类型只是占位，接口未稳定，随时会变

// ============================================================================
// Content Reference Types
// ============================================================================

/**
 * Reference category for content references
 */
export enum ReferenceCategory {
  CITATION = 'citation',
  MENTION = 'mention'
}

/**
 * Citation source type
 */
export enum CitationType {
  WEB = 'web',
  KNOWLEDGE = 'knowledge',
  MEMORY = 'memory'
}

/**
 * Base reference structure for inline content references
 */
export interface BaseReference {
  category: ReferenceCategory
  /** Text marker in content, e.g., "[1]", "@user" */
  marker?: string
  /** Position range in content */
  range?: { start: number; end: number }
}

/**
 * Base citation reference
 */
interface BaseCitationReference extends BaseReference {
  category: ReferenceCategory.CITATION
  citationType: CitationType
}

/**
 * Web search citation reference
 * Data structure compatible with WebSearchResponse from renderer
 */
export interface WebCitationReference extends BaseCitationReference {
  citationType: CitationType.WEB
  content: {
    results?: unknown // types needs to be migrated from renderer ( newMessage.ts )
    source: unknown // types needs to be migrated from renderer ( newMessage.ts )
  }
}

/**
 * Knowledge base citation reference
 * Data structure compatible with KnowledgeReference[] from renderer
 */
export interface KnowledgeCitationReference extends BaseCitationReference {
  citationType: CitationType.KNOWLEDGE

  // types needs to be migrated from renderer ( newMessage.ts )
  content: {
    id: number
    content: string
    sourceUrl: string
    type: string
    file?: unknown
    metadata?: Record<string, unknown>
  }[]
}

/**
 * Memory citation reference
 * Data structure compatible with MemoryItem[] from renderer
 */
export interface MemoryCitationReference extends BaseCitationReference {
  citationType: CitationType.MEMORY
  // types needs to be migrated from renderer ( newMessage.ts )
  content: {
    id: string
    memory: string
    hash?: string
    createdAt?: string
    updatedAt?: string
    score?: number
    metadata?: Record<string, unknown>
  }[]
}

/**
 * Union type of all citation references
 */
export type CitationReference = WebCitationReference | KnowledgeCitationReference | MemoryCitationReference

/**
 * Mention reference for @mentions in content
 * References a Model entity
 */
export interface MentionReference extends BaseReference {
  category: ReferenceCategory.MENTION
  /** Model ID being mentioned */
  modelId: string //FIXME 未定接口，model的数据结构还未确定，先占位
  /** Display name for the mention */
  displayName?: string
}

/**
 * Union type of all content references
 */
export type ContentReference = CitationReference | MentionReference

/**
 * Type guard: check if reference is a citation
 */
export function isCitation(ref: ContentReference): ref is CitationReference {
  return ref.category === ReferenceCategory.CITATION
}

/**
 * Type guard: check if reference is a mention
 */
export function isMention(ref: ContentReference): ref is MentionReference {
  return ref.category === ReferenceCategory.MENTION
}

/**
 * Type guard: check if reference is a web citation
 */
export function isWebCitation(ref: ContentReference): ref is WebCitationReference {
  return isCitation(ref) && ref.citationType === CitationType.WEB
}

/**
 * Type guard: check if reference is a knowledge citation
 */
export function isKnowledgeCitation(ref: ContentReference): ref is KnowledgeCitationReference {
  return isCitation(ref) && ref.citationType === CitationType.KNOWLEDGE
}

/**
 * Type guard: check if reference is a memory citation
 */
export function isMemoryCitation(ref: ContentReference): ref is MemoryCitationReference {
  return isCitation(ref) && ref.citationType === CitationType.MEMORY
}

// ============================================================================
// Message Block
// ============================================================================

export enum BlockType {
  UNKNOWN = 'unknown',
  MAIN_TEXT = 'main_text',
  THINKING = 'thinking',
  TRANSLATION = 'translation',
  IMAGE = 'image',
  CODE = 'code',
  TOOL = 'tool',
  FILE = 'file',
  ERROR = 'error',
  CITATION = 'citation',
  VIDEO = 'video',
  COMPACT = 'compact'
}

/**
 * Base message block data structure
 */
export interface BaseBlock {
  type: BlockType
  createdAt: number // timestamp
  updatedAt?: number
  // modelId?: string // v1's dead code, will be removed in v2
  metadata?: Record<string, unknown>
  error?: SerializedErrorData
}

/**
 * Serialized error for storage
 */
export interface SerializedErrorData {
  name?: string
  message: string
  code?: string
  stack?: string
  cause?: unknown
}

// Block type specific interfaces

export interface UnknownBlock extends BaseBlock {
  type: BlockType.UNKNOWN
  content?: string
}

/**
 * Main text block containing the primary message content.
 *
 * ## Migration Notes (v2.0)
 *
 * ### Added
 * - `references`: Unified inline references replacing the old citation system.
 *   Supports multiple reference types (citations, mentions) with position tracking.
 *
 * ### Removed
 * - `citationReferences`: Use `references` with `ReferenceCategory.CITATION` instead.
 * - `CitationBlock`: Citation data is now embedded in `MainTextBlock.references`.
 *   The standalone CitationBlock type is no longer used.
 */
export interface MainTextBlock extends BaseBlock {
  type: BlockType.MAIN_TEXT
  content: string
  //knowledgeBaseIds?: string[] // v1's dead code, will be removed in v2

  /**
   * Inline references embedded in the content (citations, mentions, etc.)
   * Replaces the old CitationBlock + citationReferences pattern.
   * @since v2.0
   */
  references?: ContentReference[]

  /**
   * @deprecated Use `references` with `ReferenceCategory.CITATION` instead.
   */
  // citationReferences?: {
  //   citationBlockId?: string
  //   citationBlockSource?: string
  // }[]
}

export interface ThinkingBlock extends BaseBlock {
  type: BlockType.THINKING
  content: string
  thinkingMs: number
}

export interface TranslationBlock extends BaseBlock {
  type: BlockType.TRANSLATION
  content: string
  sourceBlockId?: string
  sourceLanguage?: string
  targetLanguage: string
}

export interface CodeBlock extends BaseBlock {
  type: BlockType.CODE
  content: string
  language: string
}

export interface ImageBlock extends BaseBlock {
  type: BlockType.IMAGE
  url?: string
  fileId?: string
}

export interface ToolBlock extends BaseBlock {
  type: BlockType.TOOL
  toolId: string
  toolName?: string
  arguments?: Record<string, unknown>
  content?: string | object
}

/**
 * @deprecated Citation data is now embedded in MainTextBlock.references.
 * Use ContentReference types instead. Will be removed in v3.0.
 */
export interface CitationBlock extends BaseBlock {
  type: BlockType.CITATION
  responseData?: unknown
  knowledgeData?: unknown
  memoriesData?: unknown
}

export interface FileBlock extends BaseBlock {
  type: BlockType.FILE
  fileId: string
}

export interface VideoBlock extends BaseBlock {
  type: BlockType.VIDEO
  url?: string
  filePath?: string
}

export interface ErrorBlock extends BaseBlock {
  type: BlockType.ERROR
}

export interface CompactBlock extends BaseBlock {
  type: BlockType.COMPACT
  content: string
  compactedContent: string
}

/**
 * Union type of all message block data types
 */
export type MessageDataBlock =
  | UnknownBlock
  | MainTextBlock
  | ThinkingBlock
  | TranslationBlock
  | CodeBlock
  | ImageBlock
  | ToolBlock
  | CitationBlock
  | FileBlock
  | VideoBlock
  | ErrorBlock
  | CompactBlock

/**
 * Runtime schema for `MessageData`. Both `blocks` (deprecated v1) and
 * `parts` (v2 canonical) are optional on the TypeScript interface and
 * the DB column, so the runtime check mirrors that: accept any object,
 * reject only if either present field is the wrong shape. The previous
 * implementation required `Array.isArray(value.blocks)` which broke
 * v2-native writes like `{ data: { parts: [...] } }` from `MessageEditor`.
 * The discriminated-union block / part types stay runtime-opaque for
 * now; tighten with per-entry schemas in a follow-up.
 */
export const MessageDataSchema = z.custom<MessageData>((value) => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as MessageData
  if (v.blocks !== undefined && !Array.isArray(v.blocks)) return false
  if (v.parts !== undefined && !Array.isArray(v.parts)) return false
  return true
})

// ============================================================================
// Snapshot Types (immutable records captured at message creation time)
// ============================================================================

/**
 * Model snapshot captured at message creation time.
 * Preserves model identity and metadata even if the model is later removed from provider.
 *
 * TODO: Replace with Pick/Omit from v2 Model type once stabilized.
 */
export const ModelSnapshotSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  group: z.string().optional()
})
export type ModelSnapshot = z.infer<typeof ModelSnapshotSchema>

// ============================================================================
// Message Entity Types
// ============================================================================

/**
 * Message role - user, assistant, or system
 */
export const MessageRoleSchema = z.enum(['user', 'assistant', 'system'])
export type MessageRole = z.infer<typeof MessageRoleSchema>

/**
 * Message status
 * - pending: Placeholder created, streaming in progress
 * - success: Completed successfully
 * - error: Failed with error
 * - paused: User stopped generation
 */
export const MessageStatusSchema = z.enum(['pending', 'success', 'error', 'paused'])
export type MessageStatus = z.infer<typeof MessageStatusSchema>

/**
 * Complete message entity as stored in database.
 *
 * JSON blob columns (`data`, `modelSnapshot`, `stats`) are typed via
 * {@link MessageDataSchema} / {@link ModelSnapshotSchema} / {@link MessageStatsSchema}.
 */
export const MessageSchema = z.strictObject({
  /** Message ID (UUIDv7) */
  id: z.string(),
  /** Topic ID this message belongs to */
  topicId: z.string(),
  /** Parent message ID (null for root) */
  parentId: z.string().nullable(),
  /** Message role */
  role: MessageRoleSchema,
  /** Message content (blocks with inline references) */
  data: MessageDataSchema,
  /** Searchable text extracted from data.blocks */
  searchableText: z.string().nullable().optional(),
  /** Message status */
  status: MessageStatusSchema,
  /** Siblings group ID (0 = normal branch, >0 = multi-model response group) */
  siblingsGroupId: z.number(),
  // Assistant info is derived via topic → assistant FK chain; not stored on message.
  /** Model identifier */
  modelId: z.string().nullable().optional(),
  /** Snapshot of model at message creation time */
  modelSnapshot: ModelSnapshotSchema.nullable().optional(),
  /** Trace ID for tracking */
  traceId: z.string().nullable().optional(),
  /** Statistics: token usage, performance metrics */
  stats: MessageStatsSchema.nullable().optional(),
  /** Creation timestamp (ISO string) */
  createdAt: z.iso.datetime(),
  /** Last update timestamp (ISO string) */
  updatedAt: z.iso.datetime()
})
export type Message = z.infer<typeof MessageSchema>

// ============================================================================
// Tree Structure Types
// ============================================================================

/**
 * Lightweight tree node for tree visualization (ReactFlow)
 * Contains only essential display info, not full message content
 */
export interface TreeNode {
  /** Message ID */
  id: string
  /** Parent message ID (null for root, omitted in SiblingsGroup.nodes) */
  parentId?: string | null
  /** Message role */
  role: MessageRole
  /** Content preview (first 50 characters) */
  preview: string
  /** Model identifier */
  modelId?: string | null
  /** Message status */
  status: MessageStatus
  /** Creation timestamp (ISO string) */
  createdAt: string
  /** Whether this node has children (for expand indicator) */
  hasChildren: boolean
}

/**
 * Group of sibling nodes with same parentId and siblingsGroupId
 * Used for multi-model responses in tree view
 */
export interface SiblingsGroup {
  /** Parent message ID */
  parentId: string
  /** Siblings group ID (non-zero) */
  siblingsGroupId: number
  /** Nodes in this group (parentId omitted to avoid redundancy) */
  nodes: Omit<TreeNode, 'parentId'>[]
}

/**
 * Tree query response structure
 */
export interface TreeResponse {
  /** Regular nodes (siblingsGroupId = 0) */
  nodes: TreeNode[]
  /** Multi-model response groups (siblingsGroupId != 0) */
  siblingsGroups: SiblingsGroup[]
  /** Current active node ID */
  activeNodeId: string | null
}

// ============================================================================
// Branch Message Types
// ============================================================================

/**
 * Message with optional siblings group for conversation view
 * Used in GET /topics/:id/messages response
 */
export interface BranchMessage {
  /** The message itself */
  message: Message
  /** Other messages in the same siblings group (only when siblingsGroupId != 0 and includeSiblings=true) */
  siblingsGroup?: Message[]
}

/**
 * Branch messages response structure
 */
export interface BranchMessagesResponse extends CursorPaginationResponse<BranchMessage> {
  /** Current active node ID */
  activeNodeId: string | null
}
