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
import type { BaseQueueStatus, CreateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { ItemStatus, KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
import { useEffect, useMemo, useState } from 'react'

/** Status values that indicate an item is still being processed */
const PROCESSING_STATUSES: ItemStatus[] = ['pending', 'preprocessing', 'embedding']

/** Polling interval in milliseconds when items are processing */
const PROCESSING_POLL_INTERVAL = 1000

/** API path type for knowledge base items */
type KnowledgeBaseItemsPath = `/knowledge-bases/${string}/items`

/** API path type for single knowledge base */
type KnowledgeBasePath = `/knowledge-bases/${string}`

/** API path type for single knowledge item */
type KnowledgeItemPath = `/knowledge-items/${string}`

/** API path type for queue status */
type KnowledgeQueuePath = `/knowledge-bases/${string}/queue`

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

  // Track if we have processing items (use state to persist across renders)
  const [hasProcessingItems, setHasProcessingItems] = useState(false)

  // Single query with conditional polling
  const { data, isLoading, isRefreshing, error, refetch, mutate } = useQuery(path, {
    enabled,
    swrOptions: {
      // Only poll when we have processing items
      refreshInterval: hasProcessingItems ? PROCESSING_POLL_INTERVAL : 0,
      dedupingInterval: PROCESSING_POLL_INTERVAL
    }
  })

  // Memoize items extraction to avoid creating new array on every render
  const items = useMemo<KnowledgeItem[]>(() => (data as KnowledgeItem[] | undefined) ?? [], [data])

  // Update processing state when items change
  useEffect(() => {
    const processing = items.some((item) => PROCESSING_STATUSES.includes(item.status))
    setHasProcessingItems(processing)
  }, [items])

  return {
    /** Knowledge items with latest status */
    items,
    /** Total number of items */
    total: items.length,
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
  const path: KnowledgeBasePath = `/knowledge-bases/${baseId}`

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
 * Hook for fetching queue status of a knowledge base.
 *
 * Used to detect orphan tasks (tasks stuck after app crash).
 *
 * @param baseId - The knowledge base ID to check queue status for
 * @param options - Optional configuration
 * @param options.enabled - Set to false to disable fetching (default: true)
 * @returns Query result with queue status and orphan detection
 *
 * @example
 * ```typescript
 * const { hasOrphans, orphanCount, refetch } = useKnowledgeQueueStatus(baseId)
 *
 * if (hasOrphans) {
 *   return <RecoverButton count={orphanCount} />
 * }
 * ```
 */
export function useKnowledgeQueueStatus(
  baseId: string,
  options?: {
    /** Set to false to disable fetching (default: true) */
    enabled?: boolean
  }
) {
  const enabled = options?.enabled !== false && !!baseId
  const path: KnowledgeQueuePath = `/knowledge-bases/${baseId}/queue`

  const { data, isLoading, error, refetch } = useQuery(path, { enabled })
  const queueStatus = data as BaseQueueStatus | undefined

  return {
    /** Queue status data */
    queueStatus,
    /** True if there are orphan items */
    hasOrphans: (queueStatus?.orphanItemIds?.length ?? 0) > 0,
    /** Number of orphan items */
    orphanCount: queueStatus?.orphanItemIds?.length ?? 0,
    /** True during initial load */
    isLoading,
    /** Error if the request failed */
    error,
    /** Manually trigger a refresh */
    refetch
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

  // Track if item is processing (use state to persist across renders)
  const [isProcessing, setIsProcessing] = useState(false)

  // Single query with conditional polling
  const { data, isLoading, isRefreshing, error, refetch, mutate } = useQuery(path, {
    enabled,
    swrOptions: {
      // Only poll when item is processing
      refreshInterval: isProcessing ? PROCESSING_POLL_INTERVAL : 0
    }
  })

  const item = data as KnowledgeItem | undefined

  // Update processing state when item changes
  useEffect(() => {
    const status = item?.status ?? 'idle'
    const processing = PROCESSING_STATUSES.includes(status)
    setIsProcessing(processing)
  }, [item])

  return {
    /** Knowledge item with latest status */
    item,
    /** Current processing status */
    status: item?.status ?? 'idle',
    /** True if item is being processed */
    isProcessing,
    /** Error message if processing failed */
    processingError: item?.error,
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
  const { data, isLoading, isRefreshing, error, refetch, mutate } = useQuery('/knowledge-bases', {
    enabled
  })

  const bases = useMemo<KnowledgeBase[]>(() => (data as KnowledgeBase[] | undefined) ?? [], [data])

  /**
   * Create a new knowledge base
   */
  const createKnowledgeBase = async (dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> => {
    setIsCreating(true)
    try {
      const result = await dataApiService.post('/knowledge-bases' as any, {
        body: dto
      })
      await invalidate('/knowledge-bases')
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
      await dataApiService.patch(`/knowledge-bases/${baseId}` as any, {
        body: { name }
      })
      await invalidate('/knowledge-bases')
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
      await dataApiService.delete(`/knowledge-bases/${baseId}` as any)
      await invalidate('/knowledge-bases')
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
