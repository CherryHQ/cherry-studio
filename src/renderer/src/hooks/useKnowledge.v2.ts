/**
 * Knowledge hooks v2 - Data API based
 *
 * Provides hooks for knowledge base operations using the v2 Data API.
 * During migration, this coexists with useKnowledge.ts (v1 Redux-based).
 */

import { loggerService } from '@logger'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAppDispatch } from '@renderer/store'
import { addFiles as addFilesAction, addItem } from '@renderer/store/knowledge'
import type { FileMetadata, KnowledgeItem } from '@renderer/types'
import type { CreateKnowledgeItemDto } from '@shared/data/api/schemas/knowledge'
import type {
  DirectoryItemData,
  FileItemData,
  ItemStatus,
  KnowledgeItem as KnowledgeItemV2,
  SitemapItemData,
  UrlItemData
} from '@shared/data/types/knowledge'

const logger = loggerService.withContext('useKnowledge.v2')

/**
 * Map v2 ItemStatus to v1 ProcessingStatus
 */
const mapV2StatusToV1 = (status: ItemStatus): KnowledgeItem['processingStatus'] => {
  const statusMap: Record<ItemStatus, KnowledgeItem['processingStatus']> = {
    idle: 'pending',
    pending: 'pending',
    preprocessing: 'processing',
    embedding: 'processing',
    completed: 'completed',
    failed: 'failed'
  }
  return statusMap[status] ?? 'pending'
}

/**
 * Convert v2 KnowledgeItem (file type) to v1 format for Redux compatibility
 */
const toV1FileItem = (item: KnowledgeItemV2): KnowledgeItem => {
  const data = item.data as FileItemData
  return {
    id: item.id,
    type: item.type,
    content: data.file,
    created_at: Date.parse(item.createdAt),
    updated_at: Date.parse(item.updatedAt),
    processingStatus: mapV2StatusToV1(item.status),
    processingProgress: 0,
    processingError: item.error ?? '',
    retryCount: 0
  }
}

/**
 * Convert v2 KnowledgeItem (directory type) to v1 format for Redux compatibility
 */
const toV1DirectoryItem = (item: KnowledgeItemV2): KnowledgeItem => {
  const data = item.data as DirectoryItemData
  return {
    id: item.id,
    type: item.type,
    content: data.path,
    created_at: Date.parse(item.createdAt),
    updated_at: Date.parse(item.updatedAt),
    processingStatus: mapV2StatusToV1(item.status),
    processingProgress: 0,
    processingError: item.error ?? '',
    retryCount: 0
  }
}

/**
 * Convert v2 KnowledgeItem (url type) to v1 format for Redux compatibility
 */
const toV1UrlItem = (item: KnowledgeItemV2): KnowledgeItem => {
  const data = item.data as UrlItemData
  return {
    id: item.id,
    type: item.type,
    content: data.url,
    remark: data.name !== data.url ? data.name : undefined,
    created_at: Date.parse(item.createdAt),
    updated_at: Date.parse(item.updatedAt),
    processingStatus: mapV2StatusToV1(item.status),
    processingProgress: 0,
    processingError: item.error ?? '',
    retryCount: 0
  }
}

/**
 * Convert v2 KnowledgeItem (sitemap type) to v1 format for Redux compatibility
 */
const toV1SitemapItem = (item: KnowledgeItemV2): KnowledgeItem => {
  const data = item.data as SitemapItemData
  return {
    id: item.id,
    type: item.type,
    content: data.url,
    created_at: Date.parse(item.createdAt),
    updated_at: Date.parse(item.updatedAt),
    processingStatus: mapV2StatusToV1(item.status),
    processingProgress: 0,
    processingError: item.error ?? '',
    retryCount: 0
  }
}

/**
 * Hook for adding files to a knowledge base via v2 Data API
 */
export const useKnowledgeFiles = (baseId: string) => {
  const dispatch = useAppDispatch()

  const { trigger: createItemsBatchApi, isLoading: isAddingFiles } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items/batch`
  )

  /**
   * Add files to knowledge base via v2 API
   * Also updates Redux store for UI compatibility during migration
   */
  const addFiles = async (files: FileMetadata[]): Promise<KnowledgeItemV2[] | undefined> => {
    if (files.length === 0) return

    try {
      // Convert to v2 format
      const v2Items: CreateKnowledgeItemDto[] = files.map((file) => ({
        type: 'file' as const,
        data: { type: 'file' as const, file } satisfies FileItemData
      }))

      // Call v2 API (items created with status: 'pending', processing starts automatically)
      const createdItems = await createItemsBatchApi({
        body: { items: v2Items }
      })

      // Update Redux store for UI compatibility during migration
      const v1Items = createdItems.map(toV1FileItem)
      dispatch(addFilesAction({ baseId, items: v1Items }))

      logger.info('Files added via v2 API', { baseId, count: createdItems.length })
      return createdItems
    } catch (error) {
      logger.error('Failed to add files via v2 API', error as Error)
      throw error
    }
  }

  return {
    addFiles,
    isAddingFiles
  }
}

/**
 * Hook for adding directories to a knowledge base via v2 Data API
 */
export const useKnowledgeDirectories = (baseId: string) => {
  const dispatch = useAppDispatch()

  const { trigger: createItemsBatchApi, isLoading: isAddingDirectory } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items/batch`
  )

  /**
   * Add a directory to knowledge base via v2 API
   * Also updates Redux store for UI compatibility during migration
   */
  const addDirectory = async (path: string): Promise<KnowledgeItemV2 | undefined> => {
    if (!path) return

    try {
      // Convert to v2 format
      const v2Items: CreateKnowledgeItemDto[] = [
        {
          type: 'directory' as const,
          data: { type: 'directory' as const, path } satisfies DirectoryItemData
        }
      ]

      // Call v2 API (item created with status: 'pending', processing starts automatically)
      const createdItems = await createItemsBatchApi({
        body: { items: v2Items }
      })

      // Update Redux store for UI compatibility during migration
      const v1Item = toV1DirectoryItem(createdItems[0])
      dispatch(addItem({ baseId, item: v1Item }))

      logger.info('Directory added via v2 API', { baseId, path })
      return createdItems[0]
    } catch (error) {
      logger.error('Failed to add directory via v2 API', error as Error)
      throw error
    }
  }

  return {
    addDirectory,
    isAddingDirectory
  }
}

/**
 * Hook for adding URLs to a knowledge base via v2 Data API
 */
export const useKnowledgeUrls = (baseId: string) => {
  const dispatch = useAppDispatch()

  const { trigger: createItemsBatchApi, isLoading: isAddingUrl } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items/batch`
  )

  /**
   * Add a URL to knowledge base via v2 API
   * Also updates Redux store for UI compatibility during migration
   */
  const addUrl = async (url: string): Promise<KnowledgeItemV2 | undefined> => {
    if (!url) return

    try {
      // Convert to v2 format
      const v2Items: CreateKnowledgeItemDto[] = [
        {
          type: 'url' as const,
          data: { type: 'url' as const, url, name: url } satisfies UrlItemData
        }
      ]

      // Call v2 API (item created with status: 'pending', processing starts automatically)
      const createdItems = await createItemsBatchApi({
        body: { items: v2Items }
      })

      // Update Redux store for UI compatibility during migration
      const v1Item = toV1UrlItem(createdItems[0])
      dispatch(addItem({ baseId, item: v1Item }))

      logger.info('URL added via v2 API', { baseId, url })
      return createdItems[0]
    } catch (error) {
      logger.error('Failed to add URL via v2 API', error as Error)
      throw error
    }
  }

  return {
    addUrl,
    isAddingUrl
  }
}

/**
 * Hook for adding sitemaps to a knowledge base via v2 Data API
 */
export const useKnowledgeSitemaps = (baseId: string) => {
  const dispatch = useAppDispatch()

  const { trigger: createItemsBatchApi, isLoading: isAddingSitemap } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items/batch`
  )

  /**
   * Add a sitemap to knowledge base via v2 API
   * Also updates Redux store for UI compatibility during migration
   */
  const addSitemap = async (url: string): Promise<KnowledgeItemV2 | undefined> => {
    if (!url) return

    try {
      // Convert to v2 format
      const v2Items: CreateKnowledgeItemDto[] = [
        {
          type: 'sitemap' as const,
          data: { type: 'sitemap' as const, url, name: url } satisfies SitemapItemData
        }
      ]

      // Call v2 API (item created with status: 'pending', processing starts automatically)
      const createdItems = await createItemsBatchApi({
        body: { items: v2Items }
      })

      // Update Redux store for UI compatibility during migration
      const v1Item = toV1SitemapItem(createdItems[0])
      dispatch(addItem({ baseId, item: v1Item }))

      logger.info('Sitemap added via v2 API', { baseId, url })
      return createdItems[0]
    } catch (error) {
      logger.error('Failed to add sitemap via v2 API', error as Error)
      throw error
    }
  }

  return {
    addSitemap,
    isAddingSitemap
  }
}
