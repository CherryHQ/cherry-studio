/**
 * Knowledge hooks v2 - Data API based
 *
 * Provides hooks for knowledge base operations using the v2 Data API.
 * During migration, this coexists with useKnowledge.ts (v1 Redux-based).
 */

import { loggerService } from '@logger'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useAppDispatch } from '@renderer/store'
import { addFiles as addFilesAction } from '@renderer/store/knowledge'
import type { FileMetadata, KnowledgeItem } from '@renderer/types'
import type { CreateKnowledgeItemDto } from '@shared/data/api/schemas/knowledge'
import type { FileItemData, ItemStatus, KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'

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
 * Convert v2 KnowledgeItem to v1 format for Redux compatibility
 */
const toV1Item = (item: KnowledgeItemV2): KnowledgeItem => {
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
      const v1Items = createdItems.map(toV1Item)
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
