/**
 * Knowledge hooks - Data API based
 *
 * Provides hooks for knowledge base operations using the v2 Data API.
 */

import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeItems } from '@renderer/data/hooks/useKnowledgeData'
import type { FileMetadata } from '@renderer/types'
import type { CreateKnowledgeItemDto, KnowledgeSearchRequest } from '@shared/data/api/schemas/knowledges'
import type {
  DirectoryContainerData,
  FileItemData,
  ItemStatus,
  KnowledgeItem,
  KnowledgeItemTreeNode,
  KnowledgeSearchResult,
  NoteItemData,
  SitemapItemData,
  UrlItemData
} from '@shared/data/types/knowledge'
import { useMemo, useState } from 'react'

const logger = loggerService.withContext('useKnowledges')

/** Status values that indicate an item is still being processed */
const PROCESSING_STATUSES: ItemStatus[] = ['pending', 'ocr', 'read', 'embed']

interface DirectoryBuildResult {
  directoryItem: CreateKnowledgeItemDto
  childItems: CreateKnowledgeItemDto[]
}

const flattenTreeNodes = (nodes: KnowledgeItemTreeNode[]): KnowledgeItem[] => {
  const flattened: KnowledgeItem[] = []

  const traverse = (node: KnowledgeItemTreeNode) => {
    flattened.push(node.item)
    node.children.forEach(traverse)
  }

  nodes.forEach(traverse)
  return flattened
}

const buildDirectoryPayload = async (
  directoryPath: string,
  options?: { maxEntries?: number; recursive?: boolean }
): Promise<DirectoryBuildResult | null> => {
  const maxEntries = options?.maxEntries ?? 100000
  const recursive = options?.recursive ?? true

  try {
    const filePaths = await window.api.file.listDirectory(directoryPath, {
      recursive,
      includeFiles: true,
      includeDirectories: false,
      includeHidden: false,
      maxEntries,
      searchPattern: '.'
    })

    if (filePaths.length === 0) {
      return null
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

    const validFiles = files.filter((file): file is FileMetadata => file !== null)
    if (validFiles.length === 0) {
      return null
    }

    return {
      directoryItem: {
        type: 'directory',
        data: {
          path: directoryPath,
          recursive
        } satisfies DirectoryContainerData
      },
      childItems: validFiles.map((file) => ({
        type: 'file',
        data: { file } satisfies FileItemData
      }))
    }
  } catch (error) {
    logger.error('Failed to build directory payload', error as Error, {
      directoryPath
    })
    throw error
  }
}

const getDirectoryContainerNode = (
  nodes: KnowledgeItemTreeNode[],
  directoryId: string
): KnowledgeItemTreeNode | undefined => {
  for (const node of nodes) {
    if (node.item.id === directoryId && node.item.type === 'directory') {
      return node
    }

    const found = getDirectoryContainerNode(node.children, directoryId)
    if (found) {
      return found
    }
  }

  return undefined
}

const getFileChildren = (directoryNode: KnowledgeItemTreeNode): KnowledgeItem[] => {
  const fileItems: KnowledgeItem[] = []

  const collect = (node: KnowledgeItemTreeNode) => {
    for (const child of node.children) {
      if (child.item.type === 'file') {
        fileItems.push(child.item)
      }
      collect(child)
    }
  }

  collect(directoryNode)
  return fileItems
}

/**
 * Hook for adding files to a knowledge base via v2 Data API
 */
export const useKnowledgeFiles = (baseId: string) => {
  const { items } = useKnowledgeItems(baseId)
  const fileItems = useMemo(() => items.filter((item) => item.type === 'file' && !item.parentId), [items])
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
  const addFiles = async (files: FileMetadata[]): Promise<KnowledgeItem[] | undefined> => {
    if (files.length === 0) return

    try {
      const v2Items: CreateKnowledgeItemDto[] = files.map((file) => ({
        type: 'file' as const,
        data: { file } satisfies FileItemData
      }))

      const result = await createItemsApi({
        body: { items: v2Items }
      })

      const createdItems = result.items

      logger.info('Files added via v2 API', {
        baseId,
        count: createdItems.length
      })
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
      logger.error('Failed to refresh item', error as Error, {
        itemId,
        baseId
      })
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
  const { items, treeItems } = useKnowledgeItems(baseId)
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
  const addDirectory = async (path: string): Promise<KnowledgeItem | undefined> => {
    if (!path) return

    try {
      const payload = await buildDirectoryPayload(path)

      if (!payload) {
        window.toast.info('No files found in the selected directory.')
        return
      }

      const directoryResult = await createItemsApi({
        body: { items: [payload.directoryItem] }
      })

      const directory = directoryResult.items[0]
      if (!directory) {
        return undefined
      }

      if (payload.childItems.length > 0) {
        try {
          await createItemsApi({
            body: {
              items: payload.childItems.map((item) => ({
                ...item,
                parentId: directory.id
              }))
            }
          })
        } catch (childError) {
          // Clean up the empty directory container on partial failure
          logger.error('Failed to create child items, cleaning up directory container', childError as Error)
          await dataApiService.delete(`/knowledge-items/${directory.id}`)
          throw childError
        }
      }

      logger.info('Directory added via v2 API', { baseId, path, childCount: payload.childItems.length })
      return directory
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
      logger.error('Failed to refresh item', error as Error, {
        itemId,
        baseId
      })
    }
  }

  /**
   * Delete a directory node (cascades server-side).
   */
  const deleteGroup = async (directoryId: string): Promise<void> => {
    if (!baseId || !directoryId) {
      return
    }

    const directoryNode = getDirectoryContainerNode(treeItems, directoryId)

    try {
      await deleteKnowledgeItem(baseId, directoryId)
      logger.info('Directory group deleted', {
        directoryId,
        baseId,
        childCount: directoryNode ? getFileChildren(directoryNode).length : 0
      })
    } catch (error) {
      logger.error('Failed to delete directory group', error as Error, {
        directoryId,
        baseId
      })
      throw error
    }
  }

  /**
   * Refresh all file descendants in a directory group.
   */
  const refreshGroup = async (directoryId: string): Promise<void> => {
    if (!baseId || !directoryId) {
      return
    }

    const directoryNode = getDirectoryContainerNode(treeItems, directoryId)
    if (!directoryNode) {
      return
    }

    const itemsToRefresh = getFileChildren(directoryNode).filter((item) => item.status === 'completed')

    try {
      await Promise.all(itemsToRefresh.map((item) => dataApiService.post(`/knowledge-items/${item.id}/reprocess`, {})))
      await invalidate(`/knowledge-bases/${baseId}/items`)
      logger.info('Directory group refresh triggered', {
        directoryId,
        baseId,
        count: itemsToRefresh.length
      })
    } catch (error) {
      logger.error('Failed to refresh directory group', error as Error, {
        directoryId,
        baseId
      })
      throw error
    }
  }

  return {
    items,
    treeItems,
    directoryItems,
    hasProcessingItems,
    addDirectory,
    isAddingDirectory,
    deleteItem,
    isDeleting,
    refreshItem,
    deleteGroup,
    refreshGroup,
    getFileChildren
  }
}

/**
 * Hook for adding URLs to a knowledge base via v2 Data API
 */
export const useKnowledgeUrls = (baseId: string) => {
  const { items } = useKnowledgeItems(baseId)
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
  const addUrl = async (url: string): Promise<KnowledgeItem | undefined> => {
    if (!url) return

    try {
      const v2Items: CreateKnowledgeItemDto[] = [
        {
          type: 'url' as const,
          data: { url, name: url } satisfies UrlItemData
        }
      ]

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
      logger.error('Failed to refresh item', error as Error, {
        itemId,
        baseId
      })
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
  const { items } = useKnowledgeItems(baseId)
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
  const addSitemap = async (url: string): Promise<KnowledgeItem | undefined> => {
    if (!url) return

    try {
      const v2Items: CreateKnowledgeItemDto[] = [
        {
          type: 'sitemap' as const,
          data: { url, name: url } satisfies SitemapItemData
        }
      ]

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
      logger.error('Failed to refresh item', error as Error, {
        itemId,
        baseId
      })
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
  const { items } = useKnowledgeItems(baseId)
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
  const addNote = async (content: string): Promise<KnowledgeItem | undefined> => {
    if (!content) return

    try {
      const v2Items: CreateKnowledgeItemDto[] = [
        {
          type: 'note' as const,
          data: { content } satisfies NoteItemData
        }
      ]

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
      logger.error('Failed to refresh item', error as Error, {
        itemId,
        baseId
      })
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
      await dataApiService.delete(`/knowledge-items/${itemId}`)

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
  const search = async (request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]> => {
    if (!request.search?.trim()) {
      return []
    }

    setIsSearching(true)
    try {
      const results = await dataApiService.get(`/knowledge-bases/${baseId}/search`, {
        query: request
      })
      logger.info('Knowledge base search completed', {
        baseId,
        resultCount: results.length
      })
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

export { flattenTreeNodes }
