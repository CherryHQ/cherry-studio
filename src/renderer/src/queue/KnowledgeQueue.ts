import { loggerService } from '@logger'
import db from '@renderer/databases'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { NotificationService } from '@renderer/services/NotificationService'
import store from '@renderer/store'
import {
  clearCompletedProcessing,
  updateBaseItemIsPreprocessed,
  updateBaseItemUniqueId,
  updateItemProcessingStatus
} from '@renderer/store/knowledge'
import { KnowledgeItem } from '@renderer/types'
import { uuid } from '@renderer/utils'
import type { LoaderReturn } from '@shared/config/types'
import { t } from 'i18next'

const logger = loggerService.withContext('KnowledgeQueue')

class KnowledgeQueue {
  private processing: Map<string, boolean> = new Map()
  private readonly MAX_RETRIES = 1

  public async checkAllBases(): Promise<void> {
    const state = store.getState()
    const bases = state.knowledge.bases

    await Promise.all(
      bases.map(async (base) => {
        const processableItems = base.items.filter((item) => {
          if (item.processingStatus === 'failed') {
            return !item.retryCount || item.retryCount < this.MAX_RETRIES
          }
          return item.processingStatus === 'pending'
        })

        const hasProcessableItems = processableItems.length > 0

        if (hasProcessableItems && !this.processing.get(base.id)) {
          await this.processQueue(base.id)
        }
      })
    )
  }

  async processQueue(baseId: string): Promise<void> {
    if (this.processing.get(baseId)) {
      logger.info(`Queue for base ${baseId} is already being processed`)
      return
    }

    this.processing.set(baseId, true)

    try {
      const state = store.getState()
      const base = state.knowledge.bases.find((b) => b.id === baseId)

      if (!base) {
        throw new Error('Knowledge base not found')
      }

      const findProcessableItem = () => {
        const state = store.getState()
        const base = state.knowledge.bases.find((b) => b.id === baseId)
        return (
          base?.items.find((item) => {
            if (item.processingStatus === 'failed') {
              return !item.retryCount || item.retryCount < this.MAX_RETRIES
            } else {
              return item.processingStatus === 'pending'
            }
          }) ?? null
        )
      }

      let processableItem = findProcessableItem()
      while (processableItem) {
        this.processItem(baseId, processableItem).then()
        processableItem = findProcessableItem()
      }
    } finally {
      logger.info(`Finished processing queue for base ${baseId}`)
      this.processing.set(baseId, false)
    }
  }

  stopProcessing(baseId: string): void {
    this.processing.set(baseId, false)
  }

  stopAllProcessing(): void {
    for (const baseId of this.processing.keys()) {
      this.processing.set(baseId, false)
    }
  }

  private async processItem(baseId: string, item: KnowledgeItem): Promise<void> {
    const notificationService = NotificationService.getInstance()
    const userId = getStoreSetting('userId')
    try {
      if (item.retryCount && item.retryCount >= this.MAX_RETRIES) {
        logger.info(`Item ${item.id} has reached max retries, skipping`)
        return
      }

      logger.info(`Starting to process item ${item.id} (${item.type})`)

      store.dispatch(
        updateItemProcessingStatus({
          baseId,
          itemId: item.id,
          status: 'processing',
          retryCount: (item.retryCount || 0) + 1
        })
      )

      const base = store.getState().knowledge.bases.find((b) => b.id === baseId)

      if (!base) {
        throw new Error(`[KnowledgeQueue] Knowledge base ${baseId} not found`)
      }

      const baseParams = getKnowledgeBaseParams(base)
      const sourceItem = base.items.find((i) => i.id === item.id)

      if (!sourceItem) {
        throw new Error(`[KnowledgeQueue] Source item ${item.id} not found in base ${baseId}`)
      }

      let result: LoaderReturn | null = null
      let note, content

      logger.info(`Processing item: ${sourceItem.content}`)

      switch (item.type) {
        case 'note':
          note = await db.knowledge_notes.get(item.id)
          if (note) {
            content = note.content as string
            result = await window.api.knowledgeBase.add({ base: baseParams, item: { ...sourceItem, content } })
          }
          break
        default:
          result = await window.api.knowledgeBase.add({ base: baseParams, item: sourceItem, userId: userId as string })
          break
      }

      if (!result) {
        throw new Error(`[KnowledgeQueue] Backend processing returned null for item ${item.id}`)
      }

      if (result.status === 'failed') {
        logger.error(`Backend processing error for item ${item.id}: ${result.message}`)

        const errorPrefix =
          result.messageSource === 'embedding'
            ? t('knowledge.status_embedding_failed')
            : t('knowledge.status_preprocess_failed')

        throw new Error(
          result.message ? `${errorPrefix}: ${result.message}` : `Backend processing failed for item ${item.id}`
        )
      }

      logger.info(`Successfully completed processing item ${item.id}`)

      notificationService.send({
        id: uuid(),
        type: 'success',
        title: t('knowledge.status_completed'),
        message: t('notification.knowledge.success', { type: item.type }),
        silent: false,
        timestamp: Date.now(),
        source: 'knowledge'
      })

      store.dispatch(
        updateItemProcessingStatus({
          baseId,
          itemId: item.id,
          status: 'completed'
        })
      )

      if (result) {
        store.dispatch(
          updateBaseItemUniqueId({
            baseId,
            itemId: item.id,
            uniqueId: result.uniqueId,
            uniqueIds: result.uniqueIds
          })
        )
        store.dispatch(
          updateBaseItemIsPreprocessed({
            baseId,
            itemId: item.id,
            isPreprocessed: !!base.preprocessProvider
          })
        )
      }
      logger.info(`Updated uniqueId for item ${item.id} in base ${baseId} `)

      store.dispatch(clearCompletedProcessing({ baseId }))
    } catch (error) {
      logger.error(`Error processing item ${item.id}: `, error as Error)
      notificationService.send({
        id: uuid(),
        type: 'error',
        title: t('common.knowledge_base'),
        message: t('notification.knowledge.error', {
          error: error instanceof Error ? error.message : 'Unkown error'
        }),
        silent: false,
        timestamp: Date.now(),
        source: 'knowledge'
      })

      store.dispatch(
        updateItemProcessingStatus({
          baseId,
          itemId: item.id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          retryCount: (item.retryCount || 0) + 1
        })
      )
    }
  }
}

export default new KnowledgeQueue()
