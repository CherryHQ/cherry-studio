/**
 * @fileoverview Message UI data hooks for v2 architecture migration
 *
 * This module provides hooks for fetching and managing message data:
 * - {@link useTopicMessagesFromApi} - Fetch messages via DataApi with infinite scroll
 * - {@link useStreamingSessionIds} - Get active streaming session IDs for a topic
 * - {@link useTopicMessagesUnified} - Unified entry point with Agent Session routing
 *
 * ## Architecture Overview
 *
 * Two data paths, same processing logic:
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                        Data Sources                         │
 * ├─────────────────────────────┬───────────────────────────────┤
 * │         DataApi             │          Streaming            │
 * │  useTopicMessagesFromApi()  │   useCache(session.${id})     │
 * │  (direct hook usage)        │   (component-level subscribe) │
 * └─────────────────────────────┴───────────────────────────────┘
 *                   ↓                         ↓
 *            { message, blocks }       { message, blocks }
 *                   ↓                         ↓
 *                   └───────────┬─────────────┘
 *                               ↓
 * ┌─────────────────────────────────────────────────────────────┐
 * │                   Unified UI Processing                     │
 * │   Grouping (askId/parentId) → MessageGroup → MessageItem    │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Type Conversion
 *
 * DataApi returns `shared` format, but UI expects `renderer` format.
 * Conversion is performed at the hook layer using `convertToRendererFormat`.
 *
 * | Shared (DataApi)          | Renderer (UI)               |
 * |---------------------------|-----------------------------|
 * | message.data.blocks[]     | message.blocks: string[]    |
 * | message.parentId          | message.askId               |
 * | message.stats             | message.usage + metrics     |
 * | MessageDataBlock          | MessageBlock                |
 *
 * NOTE: [v2 Migration] These conversions will be removed when UI components
 * are migrated to use shared types directly.
 */

import { useCache } from '@data/hooks/useCache'
import { useInfiniteQuery } from '@data/hooks/useDataApi'
import { LOAD_MORE_COUNT } from '@renderer/config/constant'
import { useAppSelector } from '@renderer/store'
import type { Message, MessageBlock, MessageBlockType } from '@renderer/types/newMessage'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { isAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { BranchMessage, Message as SharedMessage, MessageDataBlock } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

import { selectNewDisplayCount, useTopicMessages } from './useMessageOperations'

// Re-export for convenience
export type { BranchMessage, SharedMessage }

// ============================================================================
// Type Conversion Functions
// ============================================================================

/**
 * Converts a shared MessageDataBlock to renderer MessageBlock format.
 *
 * Key differences:
 * - Renderer blocks have `id`, `status`, `messageId` (not in shared format)
 * - Block types are structurally identical but enum values differ
 *
 * TRADEOFF: Using 'as unknown as' for type and status fields
 * because renderer's MessageBlockType/MessageBlockStatus and shared's BlockType
 * are structurally identical but TypeScript treats them as incompatible enums.
 *
 * @param block - Block in shared format from DataApi
 * @param messageId - Parent message ID for the block
 * @param index - Block index (used to generate temporary ID)
 * @returns Block in renderer format
 */
function convertBlock(block: MessageDataBlock, messageId: string, index: number): MessageBlock {
  // Generate temporary ID: messageId#index
  // NOTE: [v2 Migration] Block IDs are not persisted in DataApi.
  // Using messageId#index for React key purposes. This is stable
  // because blocks are only appended, never reordered or deleted mid-array.
  const id = `${messageId}#${index}`

  // Extract common fields, excluding shared-specific ones we'll override
  // oxlint-disable-next-line @typescript-eslint/no-unused-vars
  const { type, createdAt, updatedAt, metadata, error, ...restBlock } = block

  return {
    ...restBlock,
    id,
    messageId,
    type: type as unknown as MessageBlockType,
    createdAt: typeof createdAt === 'number' ? new Date(createdAt).toISOString() : String(createdAt),
    updatedAt: updatedAt
      ? typeof updatedAt === 'number'
        ? new Date(updatedAt).toISOString()
        : String(updatedAt)
      : undefined,
    status: MessageBlockStatus.SUCCESS,
    metadata,
    error
  } as MessageBlock
}

/**
 * Converts a shared Message to renderer format with blocks.
 *
 * Key field mappings:
 * - shared.parentId → renderer.askId (for backward compatibility)
 * - shared.stats → renderer.usage + renderer.metrics (split into two objects)
 * - shared.data.blocks → converted via convertBlock()
 *
 * NOTE: [v2 Migration] This conversion preserves the old renderer format
 * for backward compatibility with existing UI components. When UI is migrated
 * to use shared types, this function will be simplified or removed.
 *
 * @param shared - Message in shared format from DataApi
 * @returns Object containing message in renderer format and block array
 */
export function convertToRendererFormat(shared: SharedMessage): {
  message: Message
  blocks: MessageBlock[]
} {
  // Convert blocks: MessageDataBlock[] → MessageBlock[]
  const blocks = shared.data.blocks.map((block, index) => convertBlock(block, shared.id, index))

  // Convert stats to usage and metrics (split format)
  // Only create if all required fields are present
  const stats = shared.stats
  const usage =
    stats?.promptTokens !== undefined && stats?.completionTokens !== undefined && stats?.totalTokens !== undefined
      ? {
          prompt_tokens: stats.promptTokens,
          completion_tokens: stats.completionTokens,
          total_tokens: stats.totalTokens
        }
      : undefined

  // Metrics requires completion_tokens and time_completion_millsec
  const metrics =
    stats?.completionTokens !== undefined && stats?.timeCompletionMs !== undefined
      ? {
          completion_tokens: stats.completionTokens,
          time_completion_millsec: stats.timeCompletionMs,
          time_first_token_millsec: stats.timeFirstTokenMs
        }
      : undefined

  // Build renderer Message format
  const message: Message = {
    id: shared.id,
    topicId: shared.topicId,
    role: shared.role,
    assistantId: shared.assistantId ?? '',
    status: shared.status as Message['status'],
    createdAt: shared.createdAt,
    updatedAt: shared.updatedAt,
    // NOTE: [v2 Migration] blocks field stores IDs for Redux compatibility
    // New path passes block objects directly via separate blocks array
    blocks: blocks.map((b) => b.id),
    // v2 parentId → v1 askId mapping
    askId: shared.parentId ?? undefined,
    modelId: shared.modelId ?? undefined,
    traceId: shared.traceId ?? undefined,
    usage,
    metrics
    // TODO: [v2] Add model, mentions, enabledMCPs when available in shared format
  }

  return { message, blocks }
}

// ============================================================================
// Grouped Message Type
// ============================================================================

/**
 * A group of messages with their blocks.
 *
 * For single-model responses: Array contains one item.
 * For multi-model responses: Array contains all sibling responses.
 */
export interface MessageWithBlocks {
  message: Message
  blocks: MessageBlock[]
}

// ============================================================================
// DataApi Hook
// ============================================================================

interface UseTopicMessagesFromApiOptions {
  /** Items per page (default: LOAD_MORE_COUNT) */
  limit?: number
  /** Disable fetching (default: true) */
  enabled?: boolean
}

interface UseTopicMessagesFromApiResult {
  /** Grouped messages - each sub-array is a group (single or multi-model) */
  groupedMessages: MessageWithBlocks[][]
  /** Active node ID from the latest page */
  activeNodeId: string | null
  /** True during initial load */
  isLoading: boolean
  /** True if more pages are available */
  hasMore: boolean
  /** Load the next page */
  loadMore: () => void
  /** Revalidate all loaded pages */
  refresh: () => void
  /** SWR mutate function for cache control */
  mutate: () => Promise<void>
}

/**
 * Fetches messages for a topic via DataApi with infinite scroll support.
 *
 * Features:
 * - Cursor-based pagination (loads older messages towards root)
 * - Automatic multi-model grouping via siblingsGroup field
 * - Type conversion from shared to renderer format
 *
 * @param topicId - Topic ID to fetch messages for
 * @param options - Fetch options
 * @returns Messages grouped by sibling relationships
 *
 * @example
 * ```typescript
 * const { groupedMessages, hasMore, loadMore, isLoading } =
 *   useTopicMessagesFromApi(topic.id)
 *
 * // groupedMessages structure:
 * // Single model: [[{ message, blocks }]]
 * // Multi model:  [[{ message, blocks }, { message, blocks }, ...]]
 * ```
 */
export function useTopicMessagesFromApi(
  topicId: string,
  options?: UseTopicMessagesFromApiOptions
): UseTopicMessagesFromApiResult {
  const limit = options?.limit ?? LOAD_MORE_COUNT
  const enabled = options?.enabled !== false

  // Use cursor-based infinite query
  // Path matches MessageSchemas['/topics/:topicId/messages'].GET
  const { items, isLoading, hasNext, loadNext, refresh, mutate } = useInfiniteQuery(
    `/topics/${topicId}/messages` as const,
    {
      limit,
      enabled
    }
  )

  // Transform BranchMessage[] to grouped MessageWithBlocks[][]
  // API already handles multi-model grouping via siblingsGroup field
  const groupedMessages = useMemo(() => {
    if (!items?.length) return []

    return (items as BranchMessage[]).map((item) => {
      // Convert main message
      const main = convertToRendererFormat(item.message)

      // Convert siblings if present (multi-model response)
      const siblings = (item.siblingsGroup || []).map((m) => convertToRendererFormat(m))

      // Return as group: [main, ...siblings]
      return [main, ...siblings]
    })
  }, [items])

  // Extract activeNodeId from latest page metadata
  // NOTE: [v2] activeNodeId is in the response but useInfiniteQuery
  // only exposes flattened items. We could enhance useInfiniteQuery
  // to preserve metadata, but for now this is not critical.
  const activeNodeId: string | null = null // TODO: [v2] Extract from raw response

  // Wrap mutate to return Promise<void>
  const wrappedMutate = useCallback(async () => {
    await mutate()
  }, [mutate])

  return {
    groupedMessages,
    activeNodeId,
    isLoading,
    hasMore: hasNext,
    loadMore: loadNext,
    refresh,
    mutate: wrappedMutate
  }
}

// ============================================================================
// Streaming Session Hooks
// ============================================================================

/**
 * Gets active streaming session IDs for a topic.
 *
 * This hook subscribes to the topic's session index in cache.
 * Use in parent component to render StreamingMessageItem.v2 for each session.
 *
 * @param topicId - Topic ID to get streaming sessions for
 * @returns Array of active message IDs (streaming session IDs)
 *
 * @example
 * ```typescript
 * const sessionIds = useStreamingSessionIds(topic.id)
 *
 * return (
 *   <>
 *     {sessionIds.map(id => (
 *       <StreamingMessageItem key={id} messageId={id} />
 *     ))}
 *   </>
 * )
 * ```
 */
export function useStreamingSessionIds(topicId: string): string[] {
  // Uses template key: 'message.streaming.topic_sessions.${topicId}'
  const cacheKey = `message.streaming.topic_sessions.${topicId}` as const
  const [sessionIds] = useCache(cacheKey, [])
  return sessionIds
}

// ============================================================================
// Unified Entry Point
// ============================================================================

interface UseTopicMessagesUnifiedResult {
  /** Source of the data */
  source: 'dataapi' | 'legacy'
  /** For DataApi: grouped messages */
  groupedMessages?: MessageWithBlocks[][]
  /** For legacy: flat message array */
  messages?: Message[]
  /** Loading state */
  isLoading: boolean
  /** Has more pages (DataApi only) */
  hasMore?: boolean
  /** Load more function (DataApi only) */
  loadMore?: () => void
  /** Refresh function */
  refresh?: () => void
  /** Mutate function (DataApi only) */
  mutate?: () => Promise<void>
  /** Display count (legacy only) */
  displayCount?: number
}

/**
 * Unified entry point for topic messages with Agent Session routing.
 *
 * Routes to appropriate data source based on topic type:
 * - Normal topics → DataApi + Cache (new architecture)
 * - Agent sessions → Redux/Dexie (legacy, temporary)
 *
 * TRADEOFF: Maintaining two paths during migration
 * - Pros: Incremental migration, no breaking changes to Agent Sessions
 * - Cons: Code duplication, increased complexity
 * - Plan: Remove legacy path after Agent Session migration to DataApi
 *
 * @param topicId - Topic ID to fetch messages for
 * @returns Messages from appropriate source with source indicator
 *
 * @example
 * ```typescript
 * const result = useTopicMessagesUnified(topic.id)
 *
 * if (result.source === 'dataapi') {
 *   // Use result.groupedMessages
 * } else {
 *   // Use result.messages (legacy)
 * }
 * ```
 */
export function useTopicMessagesUnified(topicId: string): UseTopicMessagesUnifiedResult {
  const isAgent = isAgentSessionTopicId(topicId)

  // Always call both hooks (React rules), but only one will be enabled
  const dataApiResult = useTopicMessagesFromApi(topicId, { enabled: !isAgent })
  const legacyMessages = useTopicMessages(topicId)
  // TODO: [v2] displayCount is from Redux, used for legacy path pagination
  const displayCount = useAppSelector(selectNewDisplayCount)

  if (isAgent) {
    // TODO: [v2] Migrate Agent Sessions to DataApi
    // Currently using Redux/Dexie for Agent Session message storage
    return {
      source: 'legacy',
      messages: legacyMessages,
      isLoading: false,
      displayCount
    }
  }

  return {
    source: 'dataapi',
    groupedMessages: dataApiResult.groupedMessages,
    isLoading: dataApiResult.isLoading,
    hasMore: dataApiResult.hasMore,
    loadMore: dataApiResult.loadMore,
    refresh: dataApiResult.refresh,
    mutate: dataApiResult.mutate
  }
}
