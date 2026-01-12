/**
 * Knowledge Hooks
 *
 * Provides hooks for fetching knowledge items with smart polling for processing status updates.
 * Uses DataApi's useQuery with refreshInterval for real-time status updates.
 *
 * @see {@link docs/en/references/data/data-api-in-renderer.md} for DataApi usage patterns
 */

import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { CreateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledge'
import type { ItemStatus, KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
import { useMemo, useState } from 'react'

/** Status values that indicate an item is still being processed */
const PROCESSING_STATUSES: ItemStatus[] = ['pending', 'preprocessing', 'embedding']

/** Polling interval in milliseconds when items are processing */
const PROCESSING_POLL_INTERVAL = 500

/** API path type for knowledge base items */
type KnowledgeBaseItemsPath = `/knowledges/${string}/items`

/** API path type for single knowledge base */
type KnowledgeBasePath = `/knowledges/${string}`

/** API path type for single knowledge item */
type KnowledgeItemPath = `/knowledge-items/${string}`

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
  const path: KnowledgeBaseItemsPath = `/knowledges/${baseId}/items`

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
 * Hook for fetching a single knowledge base.
 *
 * @param baseId - The knowledge base ID to fetch
 * @param options - Optional configuration
 * @param options.enabled - Set to false to disable fetching (default: true)
 * @returns Query result with base data and loading states
 */
export function useKnowledgeBase(
  baseId: string,
  options?: {
    /** Set to false to disable fetching (default: true) */
    enabled?: boolean
  }
) {
  const enabled = options?.enabled !== false && !!baseId
  const path: KnowledgeBasePath = `/knowledges/${baseId}`

  const { data, isLoading, isRefreshing, error, refetch, mutate } = useQuery(path, {
    enabled
  })

  const base = data as KnowledgeBase | undefined

  return {
    /** Knowledge base data */
    base,
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
  const path: KnowledgeItemPath = `/knowledge-items/${itemId}`

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

/** Response type for knowledge bases list */
type KnowledgeBasesResponse = OffsetPaginationResponse<KnowledgeBase>

/**
 * Hook for fetching and managing knowledge bases via v2 Data API.
 *
 * Provides:
 * - Fetching list of knowledge bases
 * - Create knowledge base
 * - Rename knowledge base
 * - Delete knowledge base
 *
 * @param options - Optional configuration
 * @param options.enabled - Set to false to disable fetching (default: true)
 * @returns Query result with bases, mutations, and loading states
 *
 * @example
 * ```typescript
 * const { bases, isLoading, createKnowledgeBase, renameKnowledgeBase, deleteKnowledgeBase } = useKnowledgeBases()
 *
 * // Create a base
 * const newBase = await createKnowledgeBase({ name: 'My KB', embeddingModelId: 'openai:text-embedding-3-small' })
 *
 * // Rename a base
 * await renameKnowledgeBase(baseId, 'New Name')
 *
 * // Delete a base
 * await deleteKnowledgeBase(baseId)
 * ```
 */
export function useKnowledgeBases(options?: {
  /** Set to false to disable fetching (default: true) */
  enabled?: boolean
}) {
  const enabled = options?.enabled !== false
  const [isCreating, setIsCreating] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const invalidate = useInvalidateCache()

  // Fetch knowledge bases list
  const { data, isLoading, isRefreshing, error, refetch, mutate } = useQuery('/knowledges', {
    enabled
  })

  const typedData = data as KnowledgeBasesResponse | undefined
  const bases = useMemo<KnowledgeBase[]>(() => typedData?.items ?? [], [typedData])

  /**
   * Create a new knowledge base
   */
  const createKnowledgeBase = async (dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> => {
    setIsCreating(true)
    try {
      const result = await dataApiService.post('/knowledges' as any, {
        body: dto
      })
      await invalidate('/knowledges')
      return result as KnowledgeBase
    } finally {
      setIsCreating(false)
    }
  }

  /**
   * Rename a knowledge base
   */
  const renameKnowledgeBase = async (baseId: string, name: string) => {
    setIsRenaming(true)
    try {
      await dataApiService.patch(`/knowledges/${baseId}` as any, {
        body: { name }
      })
      await invalidate('/knowledges')
    } finally {
      setIsRenaming(false)
    }
  }

  /**
   * Delete a knowledge base
   * Note: Side effects (cleaning assistant/preset references) must be handled by caller
   */
  const deleteKnowledgeBase = async (baseId: string) => {
    setIsDeleting(true)
    try {
      await dataApiService.delete(`/knowledges/${baseId}` as any)
      await invalidate('/knowledges')
    } finally {
      setIsDeleting(false)
    }
  }

  return {
    /** List of knowledge bases */
    bases,
    /** True during initial load */
    isLoading,
    /** True during background revalidation */
    isRefreshing,
    /** True while creating a base */
    isCreating,
    /** True while renaming a base */
    isRenaming,
    /** True while deleting a base */
    isDeleting,
    /** Error if the request failed */
    error,
    /** Create a new knowledge base */
    createKnowledgeBase,
    /** Rename a knowledge base */
    renameKnowledgeBase,
    /** Delete a knowledge base */
    deleteKnowledgeBase,
    /** Manually trigger a refresh */
    refetch,
    /** SWR mutate for advanced cache control */
    mutate
  }
}
