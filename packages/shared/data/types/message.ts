import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
/**
 * Message Statistics - combines token usage and performance metrics
 * Replaces the separate `usage` and `metrics` fields
 */
export interface MessageStats {
  // Token consumption (from API response)
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  thoughtsTokens?: number

  // Cost (calculated at message completion time)
  cost?: number

  // Performance metrics (measured locally)
  timeFirstTokenMs?: number
  timeCompletionMs?: number
  timeThinkingMs?: number
}

// ============================================================================
// Message Data
// ============================================================================

/**
 * Message data field structure
 * This is the type for the `data` column in the message table
 */
export interface MessageData {
  blocks: MessageDataBlock[]
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

// ============================================================================
// Message Entity Types
// ============================================================================

import type { AssistantMeta, ModelMeta } from './meta'

/**
 * Message role - user, assistant, or system
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Message status
 * - pending: Placeholder created, streaming in progress
 * - success: Completed successfully
 * - error: Failed with error
 * - paused: User stopped generation
 */
export type MessageStatus = 'pending' | 'success' | 'error' | 'paused'

/**
 * Complete message entity as stored in database
 */
export interface Message {
  /** Message ID (UUIDv7) */
  id: string
  /** Topic ID this message belongs to */
  topicId: string
  /** Parent message ID (null for root) */
  parentId: string | null
  /** Message role */
  role: MessageRole
  /** Message content (blocks, mentions, etc.) */
  data: MessageData
  /** Searchable text extracted from data.blocks */
  searchableText?: string | null
  /** Message status */
  status: MessageStatus
  /** Siblings group ID (0 = normal branch, >0 = multi-model response group) */
  siblingsGroupId: number
  /** Assistant ID */
  assistantId?: string | null
  /** Preserved assistant info for display */
  assistantMeta?: AssistantMeta | null
  /** Model identifier */
  modelId?: string | null
  /** Preserved model info (provider, name) */
  modelMeta?: ModelMeta | null
  /** Trace ID for tracking */
  traceId?: string | null
  /** Statistics: token usage, performance metrics */
  stats?: MessageStats | null
  /** Creation timestamp (ISO string) */
  createdAt: string
  /** Last update timestamp (ISO string) */
  updatedAt: string
}

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
  /** Model display info */
  modelMeta?: ModelMeta | null
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
