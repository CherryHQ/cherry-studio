/**
 * Chat Mappings - Topic and Message transformation functions for Dexie → SQLite migration
 *
 * This file contains pure transformation functions that convert old data structures
 * to new SQLite-compatible formats. All functions are stateless and side-effect free.
 *
 * ## Data Flow Overview:
 *
 * ### Topics:
 * - Source: Redux `assistants.topics[]` + Dexie `topics` table (for messages)
 * - Target: SQLite `topicTable`
 *
 * ### Messages:
 * - Source: Dexie `topics.messages[]` (embedded in topic) + `message_blocks` table
 * - Target: SQLite `messageTable` with inline blocks in `data.blocks`
 *
 * ## Key Transformations:
 *
 * 1. **Message Order → Tree Structure**
 *    - Old: Linear array `topic.messages[]` with array index as order
 *    - New: Tree via `parentId` + `siblingsGroupId`
 *
 * 2. **Multi-model Responses**
 *    - Old: Multiple messages share same `askId`, `foldSelected` marks active
 *    - New: Same `parentId` + non-zero `siblingsGroupId` groups siblings
 *
 * 3. **Block Storage**
 *    - Old: `message.blocks: string[]` (IDs) + separate `message_blocks` table
 *    - New: `message.data.blocks: MessageDataBlock[]` (inline JSON)
 *
 * 4. **Citations → References**
 *    - Old: Separate `CitationMessageBlock` with response/knowledge/memories
 *    - New: Merged into `MainTextBlock.references` as typed ContentReference[]
 *
 * 5. **Mentions Dropped**
 *    - Old: `message.mentions: Model[]`
 *    - New: Not migrated — derivable from sibling responses' modelId + siblingsGroupId
 *
 * @since v2.0.0
 */

import type {
  BlockType,
  CitationReference,
  CitationType,
  CodeBlock,
  CompactBlock,
  ContentReference,
  ErrorBlock,
  FileBlock,
  ImageBlock,
  MainTextBlock,
  MessageData,
  MessageDataBlock,
  MessageStats,
  ModelSnapshot,
  ReferenceCategory,
  ThinkingBlock,
  ToolBlock,
  TranslationBlock,
  VideoBlock
} from '@shared/data/types/message'

import { legacyModelToUniqueId } from '../transformers/ModelTransformers'

// ============================================================================
// Old Type Definitions (Source Data Structures)
// ============================================================================

/**
 * Old Topic type from Redux assistants slice
 * Source: src/renderer/src/types/index.ts
 */
export interface OldTopic {
  id: string
  type?: 'chat' | 'session' // Dropped in new schema
  assistantId: string
  name: string
  createdAt: string
  updatedAt: string
  messages: OldMessage[]
  pinned?: boolean
  prompt?: string
  isNameManuallyEdited?: boolean
}

/**
 * Old Assistant type from Redux state
 * Note: In Redux state, assistant.topics[] contains topic metadata (but with messages: [])
 */
export interface OldAssistant {
  id: string
  name: string
  emoji?: string
  type: string
  topics?: OldTopicMeta[] // Topics are nested inside assistants in Redux
}

/**
 * Old Topic metadata from Redux assistants.topics[]
 *
 * Redux stores topic metadata (name, pinned, etc.) but clears messages[] to reduce storage.
 * Dexie stores topics with messages[] but may have stale metadata.
 * Migration merges: Redux metadata + Dexie messages.
 */
export interface OldTopicMeta {
  id: string
  name: string
  pinned?: boolean
  prompt?: string
  isNameManuallyEdited?: boolean
  createdAt?: string
  updatedAt?: string
}

/**
 * Old Model type for extracting ModelMeta
 */
export interface OldModel {
  id: string
  name: string
  provider: string
  group: string
}

/**
 * Old Message type from Dexie topics table
 * Source: src/renderer/src/types/newMessage.ts
 */
export interface OldMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  assistantId: string
  topicId: string
  createdAt: string
  updatedAt?: string
  // Old status includes more values, we normalize to success/error/paused
  status: 'sending' | 'pending' | 'searching' | 'processing' | 'success' | 'paused' | 'error'

  // Model info
  modelId?: string
  model?: OldModel

  // Multi-model response fields
  askId?: string // Links to user message ID
  foldSelected?: boolean // True if this is the selected response in fold view
  multiModelMessageStyle?: string // UI state, dropped

  // Content
  blocks: string[] // Block IDs referencing message_blocks table

  // Metadata
  usage?: OldUsage
  metrics?: OldMetrics
  traceId?: string

  // Dropped: mentions are redundant in tree-based architecture
  // (derivable from sibling response messages' modelId + siblingsGroupId)
  mentions?: OldModel[]

  // Dropped fields
  type?: 'clear' | 'text' | '@'
  useful?: boolean
  enabledMCPs?: unknown[]
  agentSessionId?: string
  providerMetadata?: unknown
}

/**
 * Old Usage type for token consumption
 */
export interface OldUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  thoughts_tokens?: number
  cost?: number
}

/**
 * Old Metrics type for performance measurement
 */
export interface OldMetrics {
  completion_tokens?: number
  time_completion_millsec?: number
  time_first_token_millsec?: number
  time_thinking_millsec?: number
}

/**
 * Old MessageBlock base type
 */
export interface OldMessageBlock {
  id: string
  messageId: string
  type: string
  createdAt: string
  updatedAt?: string
  status: string // Dropped in new schema
  model?: OldModel // Dropped in new schema
  metadata?: Record<string, unknown>
  error?: unknown
}

/**
 * Old MainTextMessageBlock
 */
export interface OldMainTextBlock extends OldMessageBlock {
  type: 'main_text'
  content: string
  knowledgeBaseIds?: string[] // Dropped (deprecated)
  citationReferences?: Array<{
    citationBlockId?: string
    citationBlockSource?: string
  }> // Dropped (replaced by references)
}

/**
 * Old ThinkingMessageBlock
 */
export interface OldThinkingBlock extends OldMessageBlock {
  type: 'thinking'
  content: string
  thinking_millsec: number // → thinkingMs
}

/**
 * Old TranslationMessageBlock
 */
export interface OldTranslationBlock extends OldMessageBlock {
  type: 'translation'
  content: string
  sourceBlockId?: string
  sourceLanguage?: string
  targetLanguage: string
}

/**
 * Old CodeMessageBlock
 */
export interface OldCodeBlock extends OldMessageBlock {
  type: 'code'
  content: string
  language: string
}

/**
 * Old ImageMessageBlock
 */
export interface OldImageBlock extends OldMessageBlock {
  type: 'image'
  url?: string
  file?: { id: string; [key: string]: unknown } // file.id → fileId
}

/**
 * Old FileMessageBlock
 */
export interface OldFileBlock extends OldMessageBlock {
  type: 'file'
  file: { id: string; [key: string]: unknown } // file.id → fileId
}

/**
 * Old VideoMessageBlock
 */
export interface OldVideoBlock extends OldMessageBlock {
  type: 'video'
  url?: string
  filePath?: string
}

/**
 * Old ToolMessageBlock
 */
export interface OldToolBlock extends OldMessageBlock {
  type: 'tool'
  toolId: string
  toolName?: string
  arguments?: Record<string, unknown>
  content?: string | object
}

/**
 * Old CitationMessageBlock - contains web search, knowledge, and memory references
 * This is the primary source for ContentReference transformation
 */
export interface OldCitationBlock extends OldMessageBlock {
  type: 'citation'
  response?: {
    results?: unknown
    source: unknown
  }
  knowledge?: Array<{
    id: number
    content: string
    sourceUrl: string
    type: string
    file?: unknown
    metadata?: Record<string, unknown>
  }>
  memories?: Array<{
    id: string
    memory: string
    hash?: string
    createdAt?: string
    updatedAt?: string
    score?: number
    metadata?: Record<string, unknown>
  }>
}

/**
 * Old ErrorMessageBlock
 */
export interface OldErrorBlock extends OldMessageBlock {
  type: 'error'
}

/**
 * Old CompactMessageBlock
 */
export interface OldCompactBlock extends OldMessageBlock {
  type: 'compact'
  content: string
  compactedContent: string
}

/**
 * Union of all old block types
 */
export type OldBlock =
  | OldMainTextBlock
  | OldThinkingBlock
  | OldTranslationBlock
  | OldCodeBlock
  | OldImageBlock
  | OldFileBlock
  | OldVideoBlock
  | OldToolBlock
  | OldCitationBlock
  | OldErrorBlock
  | OldCompactBlock
  | OldMessageBlock

// ============================================================================
// New Type Definitions (Target Data Structures)
// ============================================================================

/**
 * New Topic for SQLite insertion
 * Matches topicTable schema
 */
export interface NewTopic {
  id: string
  name: string | null
  isNameManuallyEdited: boolean
  assistantId: string | null
  activeNodeId: string | null
  groupId: string | null
  orderKey: string
  createdAt: number // timestamp
  updatedAt: number // timestamp
}

/**
 * New Message for SQLite insertion
 * Matches messageTable schema
 */
export interface NewMessage {
  id: string
  parentId: string | null
  topicId: string
  role: string
  data: MessageData
  searchableText: string | null
  status: 'success' | 'error' | 'paused'
  siblingsGroupId: number
  modelId: string | null
  modelSnapshot: ModelSnapshot | null
  traceId: string | null
  stats: MessageStats | null
  createdAt: number // timestamp
  updatedAt: number // timestamp
}

// ============================================================================
// Topic Transformation Functions
// ============================================================================

/**
 * Transform old Topic to new Topic format
 *
 * @param oldTopic - Source topic from Redux/Dexie
 * @param activeNodeId - Last message ID to set as active node
 * @returns New topic ready for SQLite insertion
 *
 * ## Field Mapping:
 * | Source | Target | Notes |
 * |--------|--------|-------|
 * | id | id | Direct copy |
 * | name | name | Direct copy |
 * | isNameManuallyEdited | isNameManuallyEdited | Direct copy |
 * | assistantId | assistantId | FK to assistant table (validated) |
 * | (computed) | activeNodeId | Last message ID |
 * | (none) | groupId | null (new field) |
 * | (none) | orderKey | placeholder; stamped post-stream by the migrator |
 * | createdAt | createdAt | ISO string → timestamp |
 * | updatedAt | updatedAt | ISO string → timestamp |
 *
 * ## Dropped Fields:
 * - type ('chat' | 'session'): No longer needed in new schema
 * - prompt: Topic-level prompt removed from schema; assistant prompt is authoritative
 * - pinned: Pin state lives on the polymorphic `pin` table now; the migrator
 *   reads `oldTopic.pinned` separately and emits a `pin` row for it.
 */
export function transformTopic(oldTopic: OldTopic, activeNodeId: string | null): NewTopic {
  return {
    id: oldTopic.id,
    name: oldTopic.name || null,
    isNameManuallyEdited: oldTopic.isNameManuallyEdited ?? false,
    assistantId: oldTopic.assistantId || null,
    activeNodeId,
    groupId: null, // New field, no migration source
    orderKey: '', // Stamped by ChatMigrator.insertStagedTopics post-stream.
    createdAt: parseTimestamp(oldTopic.createdAt),
    updatedAt: parseTimestamp(oldTopic.updatedAt)
  }
}

// ============================================================================
// Message Transformation Functions
// ============================================================================

/**
 * Transform old Message to new Message format
 *
 * This is the core message transformation function. It handles:
 * - Status normalization
 * - Block transformation (IDs → inline data)
 * - Citation merging into references
 * - Stats merging (usage + metrics)
 *
 * @param oldMessage - Source message from Dexie
 * @param parentId - Computed parent message ID (from tree building)
 * @param siblingsGroupId - Computed siblings group ID (from multi-model detection)
 * @param blocks - Resolved block data from message_blocks table

 * @param correctTopicId - The correct topic ID (from parent topic, not from message)
 * @returns New message ready for SQLite insertion
 *
 * ## Field Mapping:
 * | Source | Target | Notes |
 * |--------|--------|-------|
 * | id | id | Direct copy |
 * | (computed) | parentId | From tree building algorithm |
 * | (parameter) | topicId | From correctTopicId param (ensures consistency) |
 * | role | role | Direct copy |
 * | blocks + mentions + citations | data | Complex transformation |
 * | (extracted) | searchableText | Extracted from text blocks |
 * | status | status | Normalized to success/error/paused |
 * | (computed) | siblingsGroupId | From multi-model detection |
 * | model/modelId | modelId | Composite (provider::modelId) or raw fallback |
 * | traceId | traceId | Direct copy |
 * | usage + metrics | stats | Merged into single stats object |
 * | createdAt | createdAt | ISO string → timestamp |
 * | updatedAt | updatedAt | ISO string → timestamp |
 *
 * ## Dropped Fields:
 * - type ('clear' | 'text' | '@')
 * - useful (boolean)
 * - enabledMCPs (deprecated)
 * - agentSessionId (session identifier)
 * - providerMetadata (raw provider data)
 * - multiModelMessageStyle (UI state)
 * - askId (replaced by parentId)
 * - foldSelected (replaced by siblingsGroupId)
 */
export function transformMessage(
  oldMessage: OldMessage,
  parentId: string | null,
  siblingsGroupId: number,
  blocks: OldBlock[],
  correctTopicId: string
): NewMessage {
  // Transform blocks and merge citations into references
  const { dataBlocks, citationReferences, searchableText } = transformBlocks(blocks)

  // Mentions are NOT migrated. In the new tree-based architecture, which models
  // responded to a user message can be derived from sibling response messages'
  // modelId + siblingsGroupId, making stored mentions redundant.

  // Find the MainTextBlock and add citation references if any exist
  if (citationReferences.length > 0) {
    const mainTextBlock = dataBlocks.find((b) => b.type === 'main_text')
    if (mainTextBlock) {
      mainTextBlock.references = citationReferences
    }
  }

  return {
    id: oldMessage.id,
    parentId,
    topicId: correctTopicId,
    role: oldMessage.role,
    data: { blocks: dataBlocks },
    searchableText: searchableText || null,
    status: normalizeStatus(oldMessage.status),
    siblingsGroupId,
    modelId: legacyModelToUniqueId(oldMessage.model, oldMessage.modelId),
    // Snapshot of model at message creation time for historical display
    modelSnapshot: buildModelSnapshot(oldMessage.model),
    traceId: oldMessage.traceId || null,
    stats: mergeStats(oldMessage.usage, oldMessage.metrics),
    createdAt: parseTimestamp(oldMessage.createdAt),
    updatedAt: parseTimestamp(oldMessage.updatedAt || oldMessage.createdAt)
  }
}

/**
 * Build a ModelSnapshot from a legacy model object.
 * Returns null if model is missing required fields (id + provider).
 */
function buildModelSnapshot(model: OldMessage['model']): ModelSnapshot | null {
  if (!model || typeof model.id !== 'string' || typeof model.provider !== 'string') return null
  if (!model.id.trim() || !model.provider.trim()) return null
  return {
    id: model.id,
    name: (typeof model.name === 'string' ? model.name : model.id) || model.id,
    provider: model.provider,
    group: typeof model.group === 'string' ? model.group : undefined
  }
}

/**
 * Normalize old status values to new enum
 *
 * Old system has multiple transient states that don't apply to stored messages.
 * Transient states (sending/pending/searching/processing) indicate interrupted
 * operations and are mapped to 'error' — the message was not completed.
 *
 * @param oldStatus - Status from old message
 * @returns Normalized status for new message
 *
 * ## Mapping:
 * - 'success' → 'success'
 * - 'error' → 'error'
 * - 'paused' → 'paused'
 * - 'sending', 'pending', 'searching', 'processing' → 'error' (interrupted)
 */
export function normalizeStatus(oldStatus: OldMessage['status']): 'success' | 'error' | 'paused' {
  switch (oldStatus) {
    case 'success':
      return 'success'
    case 'paused':
      return 'paused'
    case 'error':
    case 'sending':
    case 'pending':
    case 'searching':
    case 'processing':
    default:
      // Transient states in persisted data indicate interrupted operations
      return 'error'
  }
}

/**
 * Merge old usage and metrics into new MessageStats
 *
 * The old system stored token usage and performance metrics in separate objects.
 * The new schema combines them into a single stats object.
 *
 * @param usage - Token usage data from old message
 * @param metrics - Performance metrics from old message
 * @returns Combined MessageStats or null if no data
 *
 * ## Field Mapping:
 * | Source | Target |
 * |--------|--------|
 * | usage.prompt_tokens | promptTokens |
 * | usage.completion_tokens | completionTokens |
 * | usage.total_tokens | totalTokens |
 * | usage.thoughts_tokens | thoughtsTokens |
 * | usage.cost | cost |
 * | metrics.time_first_token_millsec | timeFirstTokenMs |
 * | metrics.time_completion_millsec | timeCompletionMs |
 * | metrics.time_thinking_millsec | timeThinkingMs |
 */
export function mergeStats(usage?: OldUsage, metrics?: OldMetrics): MessageStats | null {
  if (!usage && !metrics) return null

  const stats: MessageStats = {}

  // Token usage
  if (usage) {
    if (usage.prompt_tokens !== undefined) stats.promptTokens = usage.prompt_tokens
    if (usage.completion_tokens !== undefined) stats.completionTokens = usage.completion_tokens
    if (usage.total_tokens !== undefined) stats.totalTokens = usage.total_tokens
    if (usage.thoughts_tokens !== undefined) stats.thoughtsTokens = usage.thoughts_tokens
    if (usage.cost !== undefined) stats.cost = usage.cost
  }

  // Performance metrics
  if (metrics) {
    if (metrics.time_first_token_millsec !== undefined) stats.timeFirstTokenMs = metrics.time_first_token_millsec
    if (metrics.time_completion_millsec !== undefined) stats.timeCompletionMs = metrics.time_completion_millsec
    if (metrics.time_thinking_millsec !== undefined) stats.timeThinkingMs = metrics.time_thinking_millsec
  }

  // Return null if no data was actually added
  return Object.keys(stats).length > 0 ? stats : null
}

// ============================================================================
// Block Transformation Functions
// ============================================================================

/**
 * Transform old blocks to new format and extract citation references
 *
 * This function:
 * 1. Converts each old block to new format (removing id, messageId, status)
 * 2. Extracts CitationMessageBlocks and converts to ContentReference[]
 * 3. Extracts searchable text from text-based blocks
 *
 * @param oldBlocks - Array of old blocks from message_blocks table
 * @returns Object containing:
 *   - dataBlocks: Transformed blocks (excluding CitationBlocks)
 *   - citationReferences: Extracted citation references
 *   - searchableText: Combined searchable text
 *
 * ## Block Type Mapping:
 * | Old Type | New Type | Notes |
 * |----------|----------|-------|
 * | main_text | MainTextBlock | Direct, references added later |
 * | thinking | ThinkingBlock | thinking_millsec → thinkingMs |
 * | translation | TranslationBlock | Direct copy |
 * | code | CodeBlock | Direct copy |
 * | image | ImageBlock | file.id → fileId |
 * | file | FileBlock | file.id → fileId |
 * | video | VideoBlock | Direct copy |
 * | tool | ToolBlock | Direct copy |
 * | citation | (removed) | Converted to MainTextBlock.references |
 * | error | ErrorBlock | Direct copy |
 * | compact | CompactBlock | Direct copy |
 * | unknown | (skipped) | Placeholder blocks are dropped |
 */
export function transformBlocks(oldBlocks: OldBlock[]): {
  dataBlocks: MessageDataBlock[]
  citationReferences: ContentReference[]
  searchableText: string
} {
  const dataBlocks: MessageDataBlock[] = []
  const citationReferences: ContentReference[] = []
  const searchableTexts: string[] = []

  for (const oldBlock of oldBlocks) {
    const transformed = transformSingleBlock(oldBlock)

    if (transformed.block) {
      dataBlocks.push(transformed.block)
    }

    if (transformed.citations) {
      citationReferences.push(...transformed.citations)
    }

    if (transformed.searchableText) {
      searchableTexts.push(transformed.searchableText)
    }
  }

  return {
    dataBlocks,
    citationReferences,
    searchableText: searchableTexts.join('\n')
  }
}

/**
 * Transform a single old block to new format
 *
 * @param oldBlock - Single old block
 * @returns Transformed block and extracted data
 */
function transformSingleBlock(oldBlock: OldBlock): {
  block: MessageDataBlock | null
  citations: ContentReference[] | null
  searchableText: string | null
} {
  const baseFields = {
    createdAt: parseTimestamp(oldBlock.createdAt),
    updatedAt: oldBlock.updatedAt ? parseTimestamp(oldBlock.updatedAt) : undefined,
    metadata: oldBlock.metadata,
    error: oldBlock.error as MessageDataBlock['error']
  }

  switch (oldBlock.type) {
    case 'main_text': {
      const block = oldBlock as OldMainTextBlock
      return {
        block: {
          type: 'main_text' as BlockType.MAIN_TEXT,
          content: block.content,
          ...baseFields
          // knowledgeBaseIds and citationReferences are intentionally dropped
          // References will be added from CitationBlocks and mentions
        } as MainTextBlock,
        citations: null,
        searchableText: block.content
      }
    }

    case 'thinking': {
      const block = oldBlock as OldThinkingBlock
      return {
        block: {
          type: 'thinking' as BlockType.THINKING,
          content: block.content,
          thinkingMs: block.thinking_millsec, // Field rename
          ...baseFields
        } as ThinkingBlock,
        citations: null,
        searchableText: block.content
      }
    }

    case 'translation': {
      const block = oldBlock as OldTranslationBlock
      return {
        block: {
          type: 'translation' as BlockType.TRANSLATION,
          content: block.content,
          sourceBlockId: block.sourceBlockId,
          sourceLanguage: block.sourceLanguage,
          targetLanguage: block.targetLanguage,
          ...baseFields
        } as TranslationBlock,
        citations: null,
        searchableText: block.content
      }
    }

    case 'code': {
      const block = oldBlock as OldCodeBlock
      return {
        block: {
          type: 'code' as BlockType.CODE,
          content: block.content,
          language: block.language,
          ...baseFields
        } as CodeBlock,
        citations: null,
        searchableText: block.content
      }
    }

    case 'image': {
      const block = oldBlock as OldImageBlock
      return {
        block: {
          type: 'image' as BlockType.IMAGE,
          url: block.url,
          fileId: block.file?.id, // file.id → fileId
          ...baseFields
        } as ImageBlock,
        citations: null,
        searchableText: null
      }
    }

    case 'file': {
      const block = oldBlock as OldFileBlock
      return {
        block: {
          type: 'file' as BlockType.FILE,
          fileId: block.file.id, // file.id → fileId
          ...baseFields
        } as FileBlock,
        citations: null,
        searchableText: null
      }
    }

    case 'video': {
      const block = oldBlock as OldVideoBlock
      return {
        block: {
          type: 'video' as BlockType.VIDEO,
          url: block.url,
          filePath: block.filePath,
          ...baseFields
        } as VideoBlock,
        citations: null,
        searchableText: null
      }
    }

    case 'tool': {
      const block = oldBlock as OldToolBlock
      return {
        block: {
          type: 'tool' as BlockType.TOOL,
          toolId: block.toolId,
          toolName: block.toolName,
          arguments: block.arguments,
          content: block.content,
          ...baseFields
        } as ToolBlock,
        citations: null,
        searchableText: null
      }
    }

    case 'citation': {
      // CitationBlocks are NOT converted to blocks
      // Instead, their content is extracted as ContentReferences
      const block = oldBlock as OldCitationBlock
      const citations = extractCitationReferences(block)
      return {
        block: null, // No block output
        citations,
        searchableText: null
      }
    }

    case 'error': {
      return {
        block: {
          type: 'error' as BlockType.ERROR,
          ...baseFields
        } as ErrorBlock,
        citations: null,
        searchableText: null
      }
    }

    case 'compact': {
      const block = oldBlock as OldCompactBlock
      return {
        block: {
          type: 'compact' as BlockType.COMPACT,
          content: block.content,
          compactedContent: block.compactedContent,
          ...baseFields
        } as CompactBlock,
        citations: null,
        searchableText: block.content
      }
    }

    case 'unknown':
    default:
      // Skip unknown/placeholder blocks
      return {
        block: null,
        citations: null,
        searchableText: null
      }
  }
}

/**
 * Extract ContentReferences from old CitationMessageBlock
 *
 * Old CitationBlocks contain three types of citations:
 * - response (web search results) → WebCitationReference
 * - knowledge (knowledge base refs) → KnowledgeCitationReference
 * - memories (memory items) → MemoryCitationReference
 *
 * @param citationBlock - Old CitationMessageBlock
 * @returns Array of ContentReferences
 */
export function extractCitationReferences(citationBlock: OldCitationBlock): ContentReference[] {
  const references: ContentReference[] = []

  // Web search citations
  if (citationBlock.response) {
    references.push({
      category: 'citation' as ReferenceCategory.CITATION,
      citationType: 'web' as CitationType.WEB,
      content: {
        results: citationBlock.response.results,
        source: citationBlock.response.source
      }
    } as CitationReference)
  }

  // Knowledge base citations
  if (citationBlock.knowledge && citationBlock.knowledge.length > 0) {
    references.push({
      category: 'citation' as ReferenceCategory.CITATION,
      citationType: 'knowledge' as CitationType.KNOWLEDGE,
      content: citationBlock.knowledge.map((k) => ({
        id: k.id,
        content: k.content,
        sourceUrl: k.sourceUrl,
        type: k.type,
        file: k.file,
        metadata: k.metadata
      }))
    } as CitationReference)
  }

  // Memory citations
  if (citationBlock.memories && citationBlock.memories.length > 0) {
    references.push({
      category: 'citation' as ReferenceCategory.CITATION,
      citationType: 'memory' as CitationType.MEMORY,
      content: citationBlock.memories.map((m) => ({
        id: m.id,
        memory: m.memory,
        hash: m.hash,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        score: m.score,
        metadata: m.metadata
      }))
    } as CitationReference)
  }

  return references
}

// ============================================================================
// Tree Building Functions
// ============================================================================

/**
 * Build message tree structure from linear message array
 *
 * The old system stores messages in a linear array. The new system uses
 * a tree structure with parentId for navigation.
 *
 * ## Algorithm:
 * 1. Process messages in array order (which is the conversation order)
 * 2. For each message:
 *    - If it's a user message or first message, parent is the previous message
 *    - If it's an assistant message with askId, link to that user message
 *    - If multiple messages share same askId, they form a siblings group
 *
 * @param messages - Messages in array order from old topic
 * @returns Map of messageId → { parentId, siblingsGroupId }
 *
 * ## Example:
 * ```
 * Input: [u1, a1, u2, a2, a3(askId=u2,foldSelected), a4(askId=u2), u3]
 *
 * Output:
 * u1: { parentId: null, siblingsGroupId: 0 }
 * a1: { parentId: 'u1', siblingsGroupId: 0 }
 * u2: { parentId: 'a1', siblingsGroupId: 0 }
 * a2: { parentId: 'u2', siblingsGroupId: 1 }  // Multi-model group
 * a3: { parentId: 'u2', siblingsGroupId: 1 }  // Selected one
 * a4: { parentId: 'u2', siblingsGroupId: 1 }
 * u3: { parentId: 'a3', siblingsGroupId: 0 }  // Links to foldSelected
 * ```
 */
export function buildMessageTree(
  messages: OldMessage[]
): Map<string, { parentId: string | null; siblingsGroupId: number }> {
  const result = new Map<string, { parentId: string | null; siblingsGroupId: number }>()

  if (messages.length === 0) return result

  // Track askId → siblingsGroupId mapping
  // Each unique askId with multiple responses gets a unique siblingsGroupId
  const askIdToGroupId = new Map<string, number>()
  const askIdCounts = new Map<string, number>()

  // First pass: count messages per askId to identify multi-model responses
  for (const msg of messages) {
    if (msg.askId) {
      askIdCounts.set(msg.askId, (askIdCounts.get(msg.askId) || 0) + 1)
    }
  }

  // Assign group IDs to askIds with multiple responses
  let nextGroupId = 1
  for (const [askId, count] of askIdCounts) {
    if (count > 1) {
      askIdToGroupId.set(askId, nextGroupId++)
    }
  }

  // Build set of known message IDs for validating references
  const knownIds = new Set(messages.map((m) => m.id))

  // Track fallback parent for orphaned askId groups (user message deleted)
  // All messages in the same orphaned group share the previousMessageId at the time
  // the first group member is encountered, preserving sibling relationships.
  const orphanedGroupParent = new Map<string, string | null>()

  // Second pass: build parent/sibling relationships
  let previousMessageId: string | null = null
  let lastNonGroupMessageId: string | null = null // Last message not in a group, for linking subsequent user messages
  let lastGroupFallbackId: string | null = null // Last group member as fallback when no foldSelected
  let groupHasFoldSelected = false // Whether current group has a foldSelected member

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    let parentId: string | null = null
    let siblingsGroupId = 0

    if (msg.askId && askIdToGroupId.has(msg.askId)) {
      siblingsGroupId = askIdToGroupId.get(msg.askId)!

      if (knownIds.has(msg.askId)) {
        // Normal multi-model: parent is the user message
        parentId = msg.askId
      } else {
        // Orphaned multi-model: user message deleted, share a common fallback parent
        if (!orphanedGroupParent.has(msg.askId)) {
          orphanedGroupParent.set(msg.askId, previousMessageId)
        }
        parentId = orphanedGroupParent.get(msg.askId) ?? null
      }

      // Track selected response or last group member for linking subsequent user messages
      if (msg.foldSelected) {
        lastNonGroupMessageId = msg.id
        groupHasFoldSelected = true
      }
      if (!groupHasFoldSelected) {
        lastGroupFallbackId = msg.id
      }
    } else if (msg.role === 'user' && (lastNonGroupMessageId || lastGroupFallbackId)) {
      // User message after a multi-model group links to the selected (or last) response.
      // lastGroupFallbackId takes priority: it means the group had no foldSelected,
      // so the user message should follow the last group member, not the pre-group message.
      parentId = lastGroupFallbackId ?? lastNonGroupMessageId
      lastNonGroupMessageId = null
      lastGroupFallbackId = null
      groupHasFoldSelected = false
    } else {
      // Normal sequential message - parent is previous message
      parentId = previousMessageId
    }

    result.set(msg.id, { parentId, siblingsGroupId })

    // Update tracking for next iteration
    previousMessageId = msg.id

    // Update lastNonGroupMessageId for non-group messages
    if (siblingsGroupId === 0) {
      lastNonGroupMessageId = msg.id
      lastGroupFallbackId = null
      groupHasFoldSelected = false
    }
  }

  return result
}

/**
 * Find the activeNodeId for a topic
 *
 * The activeNodeId should be the last message in the main conversation thread.
 * For multi-model responses, it should be the foldSelected one.
 *
 * @param messages - Messages in array order
 * @returns The ID of the last message (or foldSelected if applicable)
 */
export function findActiveNodeId(messages: OldMessage[]): string | null {
  if (messages.length === 0) return null

  // Find the last message
  // If it's part of a multi-model group, find the foldSelected one
  const lastMsg = messages[messages.length - 1]

  if (lastMsg.askId) {
    // Check if there's a foldSelected message with the same askId
    const selectedMsg = messages.find((m) => m.askId === lastMsg.askId && m.foldSelected)
    if (selectedMsg) return selectedMsg.id
  }

  return lastMsg.id
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse ISO timestamp string to Unix timestamp (milliseconds)
 *
 * @param isoString - ISO 8601 timestamp string or undefined
 * @returns Unix timestamp in milliseconds
 */
export function parseTimestamp(isoString: string | null | undefined): number {
  if (isoString == null) return Date.now() // handles both null and undefined
  if (!isoString) return Date.now() // handles empty string

  const parsed = new Date(isoString).getTime()
  return isNaN(parsed) ? Date.now() : parsed
}

/**
 * Build block lookup map from message_blocks table
 *
 * Creates a Map of blockId → block for fast lookup during message transformation.
 *
 * @param blocks - All blocks from message_blocks table
 * @returns Map for O(1) block lookup
 */
export function buildBlockLookup(blocks: OldBlock[]): Map<string, OldBlock> {
  const lookup = new Map<string, OldBlock>()
  for (const block of blocks) {
    lookup.set(block.id, block)
  }
  return lookup
}

/**
 * Resolve block IDs to actual block data
 *
 * @param blockIds - Array of block IDs from message.blocks
 * @param blockLookup - Map of blockId → block
 * @returns Array of resolved blocks (missing blocks are skipped)
 */
export function resolveBlocks(blockIds: string[], blockLookup: Map<string, OldBlock>): OldBlock[] {
  const resolved: OldBlock[] = []
  for (const id of blockIds) {
    const block = blockLookup.get(id)
    if (block) {
      resolved.push(block)
    }
  }
  return resolved
}
