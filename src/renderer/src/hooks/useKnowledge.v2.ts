/**
 * Knowledge hooks v2 - Data API based
 *
 * Provides hooks for knowledge base operations using the v2 Data API.
 * During migration, this coexists with useKnowledge.ts (v1 Redux-based).
 */

import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeItems } from '@renderer/data/hooks/useKnowledges'
import type { FileMetadata } from '@renderer/types'
import { uuid } from '@renderer/utils'
import type { CreateKnowledgeItemDto, KnowledgeSearchRequest } from '@shared/data/api/schemas/knowledges'
import type {
  DirectoryItemData,
  FileItemData,
  ItemStatus,
  KnowledgeItem as KnowledgeItemV2,
  KnowledgeSearchResult,
  NoteItemData,
  SitemapItemData,
  UrlItemData
} from '@shared/data/types/knowledge'
import { useMemo, useState } from 'react'

const logger = loggerService.withContext('useKnowledge.v2')

/** Status values that indicate an item is still being processed */
const PROCESSING_STATUSES: ItemStatus[] = ['pending', 'preprocessing', 'embedding']

const buildDirectoryItems = async (
  directoryPath: string,
  options?: { maxEntries?: number }
): Promise<CreateKnowledgeItemDto[]> => {
  const groupId = uuid()
  const groupName = directoryPath
  const maxEntries = options?.maxEntries ?? 100000

  try {
    const filePaths = await window.api.file.listDirectory(directoryPath, {
      recursive: true,
      includeFiles: true,
      includeDirectories: false,
      includeHidden: false,
      maxEntries,
      searchPattern: '.'
    })

    if (filePaths.length === 0) {
      return []
    }

    const files = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          return await window.api.file.get(filePath)
        } catch (error) {
          logger.warn('Failed to read file metadata for directory item', error as Error, { filePath })
          return null
        }
      })
    )

    return files
      .filter((file): file is FileMetadata => file !== null)
      .map((file) => ({
        type: 'directory' as const,
        data: { groupId, groupName, file } satisfies DirectoryItemData
      }))
  } catch (error) {
    logger.error('Failed to build directory items', error as Error, { directoryPath })
    throw error
  }
}

/**
 * Hook for adding files to a knowledge base via v2 Data API
 */
export const useKnowledgeFiles = (baseId: string) => {
  const { items } = useKnowledgeItems(baseId, { enabled: !!baseId })
  const fileItems = useMemo(() => items.filter((item) => item.type === 'file'), [items])
  const hasProcessingItems = useMemo(
    () => fileItems.some((item) => PROCESSING_STATUSES.includes(item.status)),
    [fileItems]
  )

  const { trigger: createItemsApi, isLoading: isAddingFiles } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items`,
    {
      refresh: [`/knowledge-bases/${baseId}/items`]
    }
  )

  const { deleteItem: deleteKnowledgeItem, isDeleting } = useKnowledgeItemDelete()
  const invalidate = useInvalidateCache()

  /**
   * Add files to knowledge base via v2 API
   */
  const addFiles = async (files: FileMetadata[]): Promise<KnowledgeItemV2[] | undefined> => {
    if (files.length === 0) return

    try {
      // Convert to v2 format
      const v2Items: CreateKnowledgeItemDto[] = files.map((file) => ({
        type: 'file' as const,
        data: { file } satisfies FileItemData
      }))

      // Call v2 API (items created with status: 'pending', processing starts automatically)
      const result = await createItemsApi({
        body: { items: v2Items }
      })

      const createdItems = result.items

      logger.info('Files added via v2 API', { baseId, count: createdItems.length })
      return createdItems
    } catch (error) {
      logger.error('Failed to add files via v2 API', error as Error)
      throw error
    }
  }

  /**
   * Delete a file item via v2 API
   */
  const deleteItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    return deleteKnowledgeItem(baseId, itemId)
  }

  /**
   * Refresh a file item via v2 API (triggers reprocessing)
   */
  const refreshItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    try {
      await dataApiService.post(`/knowledge-items/${itemId}/reprocess`, {})
      await invalidate(`/knowledge-bases/${baseId}/items`)
      logger.info('Item refresh triggered', { itemId, baseId })
    } catch (error) {
      logger.error('Failed to refresh item', error as Error, { itemId, baseId })
    }
  }

  return {
    items,
    fileItems,
    hasProcessingItems,
    addFiles,
    isAddingFiles,
    deleteItem,
    isDeleting,
    refreshItem
  }
}

/**
 * Hook for adding directories to a knowledge base via v2 Data API
 */
export const useKnowledgeDirectories = (baseId: string) => {
  const { items } = useKnowledgeItems(baseId, { enabled: !!baseId })
  const directoryItems = useMemo(() => items.filter((item) => item.type === 'directory'), [items])
  const hasProcessingItems = useMemo(
    () => directoryItems.some((item) => PROCESSING_STATUSES.includes(item.status)),
    [directoryItems]
  )
  const { trigger: createItemsApi, isLoading: isAddingDirectory } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items`,
    {
      refresh: [`/knowledge-bases/${baseId}/items`]
    }
  )

  /**
   * Add a directory to knowledge base via v2 API
   */
  const addDirectory = async (path: string): Promise<KnowledgeItemV2 | undefined> => {
    if (!path) return

    try {
      const v2Items = await buildDirectoryItems(path)

      if (v2Items.length === 0) {
        window.toast.info('No files found in the selected directory.')
        return
      }

      // Call v2 API (item created with status: 'pending', processing starts automatically)
      const result = await createItemsApi({
        body: { items: v2Items }
      })

      const createdItems = result.items

      logger.info('Directory added via v2 API', { baseId, path })
      return createdItems[0]
    } catch (error) {
      logger.error('Failed to add directory via v2 API', error as Error)
      throw error
    }
  }

  const { deleteItem: deleteKnowledgeItem, isDeleting } = useKnowledgeItemDelete()
  const invalidate = useInvalidateCache()

  const deleteItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    return deleteKnowledgeItem(baseId, itemId)
  }

  const refreshItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    try {
      await dataApiService.post(`/knowledge-items/${itemId}/reprocess`, {})
      await invalidate(`/knowledge-bases/${baseId}/items`)
      logger.info('Item refresh triggered', { itemId, baseId })
    } catch (error) {
      logger.error('Failed to refresh item', error as Error, { itemId, baseId })
    }
  }

  return {
    items,
    directoryItems,
    hasProcessingItems,
    addDirectory,
    isAddingDirectory,
    deleteItem,
    isDeleting,
    refreshItem
  }
}

/**
 * Hook for adding URLs to a knowledge base via v2 Data API
 */
export const useKnowledgeUrls = (baseId: string) => {
  const { items } = useKnowledgeItems(baseId, { enabled: !!baseId })
  const urlItems = useMemo(() => items.filter((item) => item.type === 'url'), [items])
  const hasProcessingItems = useMemo(
    () => urlItems.some((item) => PROCESSING_STATUSES.includes(item.status)),
    [urlItems]
  )
  const { trigger: createItemsApi, isLoading: isAddingUrl } = useMutation('POST', `/knowledge-bases/${baseId}/items`, {
    refresh: [`/knowledge-bases/${baseId}/items`]
  })

  /**
   * Add a URL to knowledge base via v2 API
   */
  const addUrl = async (url: string): Promise<KnowledgeItemV2 | undefined> => {
    if (!url) return

    try {
      // Convert to v2 format
      const v2Items: CreateKnowledgeItemDto[] = [
        {
          type: 'url' as const,
          data: { url, name: url } satisfies UrlItemData
        }
      ]

      // Call v2 API (item created with status: 'pending', processing starts automatically)
      const result = await createItemsApi({
        body: { items: v2Items }
      })

      const createdItems = result.items

      logger.info('URL added via v2 API', { baseId, url })
      return createdItems[0]
    } catch (error) {
      logger.error('Failed to add URL via v2 API', error as Error)
      throw error
    }
  }

  const { deleteItem: deleteKnowledgeItem, isDeleting } = useKnowledgeItemDelete()
  const invalidate = useInvalidateCache()

  const deleteItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    return deleteKnowledgeItem(baseId, itemId)
  }

  const refreshItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    try {
      await dataApiService.post(`/knowledge-items/${itemId}/reprocess`, {})
      await invalidate(`/knowledge-bases/${baseId}/items`)
      logger.info('Item refresh triggered', { itemId, baseId })
    } catch (error) {
      logger.error('Failed to refresh item', error as Error, { itemId, baseId })
    }
  }

  return {
    items,
    urlItems,
    hasProcessingItems,
    addUrl,
    isAddingUrl,
    deleteItem,
    isDeleting,
    refreshItem
  }
}

/**
 * Hook for adding sitemaps to a knowledge base via v2 Data API
 */
export const useKnowledgeSitemaps = (baseId: string) => {
  const { items } = useKnowledgeItems(baseId, { enabled: !!baseId })
  const sitemapItems = useMemo(() => items.filter((item) => item.type === 'sitemap'), [items])
  const hasProcessingItems = useMemo(
    () => sitemapItems.some((item) => PROCESSING_STATUSES.includes(item.status)),
    [sitemapItems]
  )
  const { trigger: createItemsApi, isLoading: isAddingSitemap } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items`,
    {
      refresh: [`/knowledge-bases/${baseId}/items`]
    }
  )

  /**
   * Add a sitemap to knowledge base via v2 API
   */
  const addSitemap = async (url: string): Promise<KnowledgeItemV2 | undefined> => {
    if (!url) return

    try {
      // Convert to v2 format
      const v2Items: CreateKnowledgeItemDto[] = [
        {
          type: 'sitemap' as const,
          data: { url, name: url } satisfies SitemapItemData
        }
      ]

      // Call v2 API (item created with status: 'pending', processing starts automatically)
      const result = await createItemsApi({
        body: { items: v2Items }
      })

      const createdItems = result.items

      logger.info('Sitemap added via v2 API', { baseId, url })
      return createdItems[0]
    } catch (error) {
      logger.error('Failed to add sitemap via v2 API', error as Error)
      throw error
    }
  }

  const { deleteItem: deleteKnowledgeItem, isDeleting } = useKnowledgeItemDelete()
  const invalidate = useInvalidateCache()

  const deleteItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    return deleteKnowledgeItem(baseId, itemId)
  }

  const refreshItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    try {
      await dataApiService.post(`/knowledge-items/${itemId}/reprocess`, {})
      await invalidate(`/knowledge-bases/${baseId}/items`)
      logger.info('Item refresh triggered', { itemId, baseId })
    } catch (error) {
      logger.error('Failed to refresh item', error as Error, { itemId, baseId })
    }
  }

  return {
    items,
    sitemapItems,
    hasProcessingItems,
    addSitemap,
    isAddingSitemap,
    deleteItem,
    isDeleting,
    refreshItem
  }
}

/**
 * Hook for adding notes to a knowledge base via v2 Data API
 */
export const useKnowledgeNotes = (baseId: string) => {
  const { items } = useKnowledgeItems(baseId, { enabled: !!baseId })
  const noteItems = useMemo(() => items.filter((item) => item.type === 'note'), [items])
  const hasProcessingItems = useMemo(
    () => noteItems.some((item) => PROCESSING_STATUSES.includes(item.status)),
    [noteItems]
  )
  const { trigger: createItemsApi, isLoading: isAddingNote } = useMutation('POST', `/knowledge-bases/${baseId}/items`, {
    refresh: [`/knowledge-bases/${baseId}/items`]
  })

  /**
   * Add a note to knowledge base via v2 API
   */
  const addNote = async (content: string): Promise<KnowledgeItemV2 | undefined> => {
    if (!content) return

    try {
      // Convert to v2 format
      const v2Items: CreateKnowledgeItemDto[] = [
        {
          type: 'note' as const,
          data: { content } satisfies NoteItemData
        }
      ]

      // Call v2 API (item created with status: 'pending', processing starts automatically)
      const result = await createItemsApi({
        body: { items: v2Items }
      })

      const createdItems = result.items

      logger.info('Note added via v2 API', { baseId })
      return createdItems[0]
    } catch (error) {
      logger.error('Failed to add note via v2 API', error as Error)
      throw error
    }
  }

  const { deleteItem: deleteKnowledgeItem, isDeleting } = useKnowledgeItemDelete()
  const invalidate = useInvalidateCache()

  const deleteItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    return deleteKnowledgeItem(baseId, itemId)
  }

  const refreshItem = async (itemId: string): Promise<void> => {
    if (!baseId || !itemId) {
      return
    }

    try {
      await dataApiService.post(`/knowledge-items/${itemId}/reprocess`, {})
      await invalidate(`/knowledge-bases/${baseId}/items`)
      logger.info('Item refresh triggered', { itemId, baseId })
    } catch (error) {
      logger.error('Failed to refresh item', error as Error, { itemId, baseId })
    }
  }

  return {
    items,
    noteItems,
    hasProcessingItems,
    addNote,
    isAddingNote,
    deleteItem,
    isDeleting,
    refreshItem
  }
}

/**
 * Hook for deleting a knowledge item via v2 Data API
 */
export const useKnowledgeItemDelete = () => {
  const [isDeleting, setIsDeleting] = useState(false)
  const invalidate = useInvalidateCache()

  /**
   * Delete a knowledge item via v2 API
   */
  const deleteItem = async (baseId: string, itemId: string): Promise<void> => {
    setIsDeleting(true)
    try {
      // Call v2 API to delete item (also removes vectors)
      await dataApiService.delete(`/knowledge-items/${itemId}`)

      // Refresh the items list cache
      await invalidate(`/knowledge-bases/${baseId}/items`)

      logger.info('Item deleted via v2 API', { itemId, baseId })
    } catch (error) {
      logger.error('Failed to delete item via v2 API', error as Error)
      throw error
    } finally {
      setIsDeleting(false)
    }
  }

  return {
    deleteItem,
    isDeleting
  }
}

/**
 * Hook for searching a knowledge base via v2 Data API
 */
export const useKnowledgeSearch = (baseId: string) => {
  const [isSearching, setIsSearching] = useState(false)

  /**
   * Search knowledge base via v2 API
   */
  const search = async (
    request: Omit<KnowledgeSearchRequest, 'search'> & { search: string }
  ): Promise<KnowledgeSearchResult[]> => {
    if (!request.search?.trim()) {
      return []
    }

    setIsSearching(true)
    try {
      const results = await dataApiService.get(`/knowledge-bases/${baseId}/search`, {
        query: request
      })
      logger.info('Knowledge base search completed', { baseId, resultCount: results.length })
      return results
    } catch (error) {
      logger.error('Knowledge base search failed', error as Error)
      throw error
    } finally {
      setIsSearching(false)
    }
  }

  return {
    search,
    isSearching
  }
}
