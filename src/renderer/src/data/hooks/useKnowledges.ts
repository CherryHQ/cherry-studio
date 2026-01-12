/**
 * Knowledge Hooks
 *
 * Provides hooks for fetching knowledge items with smart polling for processing status updates.
 * Uses DataApi's useQuery with refreshInterval for real-time status updates.
 *
 * @see {@link docs/en/references/data/data-api-in-renderer.md} for DataApi usage patterns
 */

import { useQuery } from '@data/hooks/useDataApi'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { ItemStatus, KnowledgeItem } from '@shared/data/types/knowledge'
import { useMemo } from 'react'

/** Status values that indicate an item is still being processed */
const PROCESSING_STATUSES: ItemStatus[] = ['pending', 'preprocessing', 'embedding']

/** Polling interval in milliseconds when items are processing */
const PROCESSING_POLL_INTERVAL = 3000

/** API path type for knowledge base items */
type KnowledgeBaseItemsPath = `/knowledge-bases/${string}/items`

/** API path type for single knowledge item */
type KnowledgeItemPath = `/knowledges/${string}`

/** Response type for knowledge items list */
type KnowledgeItemsResponse = OffsetPaginationResponse<KnowledgeItem>

/**
 * Hook for fetching knowledge items with smart polling.
 *
 * Features:
 * - Automatic polling when items are being processed (pending/preprocessing/embedding)
 * - Polling stops automatically when all items are completed or failed
 * - Returns loading states and refetch function for manual refresh
 *
 * @param baseId - The knowledge base ID to fetch items for
 * @param options - Optional configuration
 * @param options.enabled - Set to false to disable fetching (default: true)
 * @returns Query result with items, loading states, and controls
 *
 * @example
 * ```typescript
 * // Basic usage
 * const { items, isLoading, hasProcessingItems } = useKnowledgeItems(baseId)
 *
 * // With options
 * const { items, refetch } = useKnowledgeItems(baseId, {
 *   enabled: !!baseId
 * })
 *
 * // Conditional rendering based on processing state
 * {hasProcessingItems && <ProcessingIndicator />}
 * ```
 */
export function useKnowledgeItems(
  baseId: string,
  options?: {
    /** Set to false to disable fetching (default: true) */
    enabled?: boolean
  }
) {
  const enabled = options?.enabled !== false && !!baseId
  const path: KnowledgeBaseItemsPath = `/knowledge-bases/${baseId}/items`

  // Fetch knowledge items
  const { data, isLoading, isRefreshing, error, refetch, mutate } = useQuery(path, {
    enabled
  })

  // Type the response data
  const typedData = data as KnowledgeItemsResponse | undefined

  // Memoize items extraction to avoid creating new array on every render
  const items = useMemo<KnowledgeItem[]>(() => typedData?.items ?? [], [typedData])
  const total = useMemo<number>(() => typedData?.total ?? 0, [typedData])

  // Check if any items are still being processed
  const hasProcessingItems = useMemo(() => items.some((item) => PROCESSING_STATUSES.includes(item.status)), [items])

  // Use a second query with polling when items are processing
  // This is a pattern recommended in the DataApi documentation
  const { data: polledData } = useQuery(path, {
    enabled: enabled && hasProcessingItems,
    swrOptions: {
      refreshInterval: PROCESSING_POLL_INTERVAL
    }
  })

  // Type the polled data
  const typedPolledData = polledData as KnowledgeItemsResponse | undefined

  // Use polled data when available and processing
  const currentItems = useMemo<KnowledgeItem[]>(
    () => (hasProcessingItems ? (typedPolledData?.items ?? items) : items),
    [hasProcessingItems, typedPolledData, items]
  )

  const currentTotal = useMemo<number>(
    () => (hasProcessingItems ? (typedPolledData?.total ?? total) : total),
    [hasProcessingItems, typedPolledData, total]
  )

  return {
    /** Knowledge items with latest status */
    items: currentItems,
    /** Total number of items */
    total: currentTotal,
    /** True during initial load */
    isLoading,
    /** True during background revalidation */
    isRefreshing,
    /** Error if the request failed */
    error,
    /** True if any items are still being processed */
    hasProcessingItems,
    /** Manually trigger a refresh */
    refetch,
    /** SWR mutate for advanced cache control */
    mutate
  }
}

/**
 * Hook for fetching a single knowledge item with smart polling.
 *
 * @param itemId - The knowledge item ID to fetch
 * @param options - Optional configuration
 * @param options.enabled - Set to false to disable fetching (default: true)
 * @returns Query result with item data and loading states
 *
 * @example
 * ```typescript
 * const { item, isProcessing, status } = useKnowledgeItem(itemId)
 *
 * if (isProcessing) {
 *   return <ProcessingSpinner progress={item?.processingProgress} />
 * }
 * ```
 */
export function useKnowledgeItem(
  itemId: string,
  options?: {
    /** Set to false to disable fetching (default: true) */
    enabled?: boolean
  }
) {
  const enabled = options?.enabled !== false && !!itemId
  const path: KnowledgeItemPath = `/knowledges/${itemId}`

  // Fetch single item
  const { data, isLoading, isRefreshing, error, refetch, mutate } = useQuery(path, {
    enabled
  })

  const item = data as KnowledgeItem | undefined
  const status = item?.status ?? 'idle'
  const isProcessing = PROCESSING_STATUSES.includes(status)

  // Poll when item is processing
  const { data: polledData } = useQuery(path, {
    enabled: enabled && isProcessing,
    swrOptions: {
      refreshInterval: PROCESSING_POLL_INTERVAL
    }
  })

  // Use polled data when processing
  const currentItem = isProcessing ? ((polledData as KnowledgeItem | undefined) ?? item) : item

  return {
    /** Knowledge item with latest status */
    item: currentItem,
    /** Current processing status */
    status: currentItem?.status ?? 'idle',
    /** True if item is being processed */
    isProcessing: PROCESSING_STATUSES.includes(currentItem?.status ?? 'idle'),
    /** Error message if processing failed */
    processingError: currentItem?.error,
    /** True during initial load */
    isLoading,
    /** True during background revalidation */
    isRefreshing,
    /** Error if the request failed */
    error,
    /** Manually trigger a refresh */
    refetch,
    /** SWR mutate for advanced cache control */
    mutate
  }
}
