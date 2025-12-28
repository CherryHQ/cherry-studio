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
  modelId?: string
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

export interface MainTextBlock extends BaseBlock {
  type: BlockType.MAIN_TEXT
  content: string
  knowledgeBaseIds?: string[]
  citationReferences?: {
    citationBlockId?: string
    citationBlockSource?: string
  }[]
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
export interface BranchMessagesResponse {
  /** Messages in root-to-leaf order */
  messages: BranchMessage[]
  /** Current active node ID */
  activeNodeId: string | null
}
