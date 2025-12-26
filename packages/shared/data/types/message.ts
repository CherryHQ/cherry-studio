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
