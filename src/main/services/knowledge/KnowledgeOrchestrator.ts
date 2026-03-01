/**
 * KnowledgeOrchestrator - Knowledge Item Processing Orchestrator
 *
 * Coordinates the processing workflow for knowledge items:
 * - Queue management via KnowledgeQueueManager
 * - Status transitions
 * - Progress tracking
 * - Delegates to KnowledgeProcessor for actual processing
 */

import { loggerService } from '@logger'
import type { ItemStatus, KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'

import { knowledgeProcessor } from './KnowledgeProcessor'
import { knowledgeServiceV2 } from './KnowledgeServiceV2'
import { type KnowledgeJob, knowledgeQueueManager } from './queue'
import type { KnowledgeStage } from './types'

const logger = loggerService.withContext('KnowledgeOrchestrator')

/**
 * Options for processing a knowledge item
 */
export interface ProcessItemOptions {
  base: KnowledgeBase
  item: KnowledgeItem
  onStatusChange?: (status: ItemStatus, error: string | null) => Promise<void>
}

/**
 * KnowledgeOrchestrator manages the processing workflow for knowledge items
 */
class KnowledgeOrchestrator {
  private jobTokens = new Map<string, number>()

  /**
   * Process a knowledge item
   * Enqueues the item for processing and handles status updates
   */
  async process(options: ProcessItemOptions): Promise<void> {
    const { base, item, onStatusChange } = options

    try {
      if (knowledgeQueueManager.isQueued(item.id) || knowledgeQueueManager.isProcessing(item.id)) {
        logger.debug('Item already queued or processing, skipping enqueue', { itemId: item.id })
        return
      }

      const createdAt = Date.now()
      this.jobTokens.set(item.id, createdAt)

      const job: KnowledgeJob = {
        baseId: base.id,
        itemId: item.id,
        type: item.type,
        createdAt
      }

      knowledgeQueueManager
        .enqueue(job, async ({ signal, runStage, updateProgress }) => {
          const isCurrentJob = () => this.jobTokens.get(item.id) === createdAt
          const updateStatus = async (status: ItemStatus, errorMessage: string | null) => {
            if (!isCurrentJob()) {
              logger.debug('Skipping status update - not current job', { itemId: item.id })
              return
            }
            await onStatusChange?.(status, errorMessage)
          }
          const updateItemProgress = (progress: number, opts?: { immediate?: boolean }) => {
            if (!isCurrentJob()) {
              return
            }
            updateProgress(progress, opts)
          }

          const handleStageChange = async (stage: KnowledgeStage) => {
            if (stage === 'ocr' || stage === 'embed') {
              await updateStatus(stage, null)
            }
          }

          const handleProgress = (progress: number) => {
            updateItemProgress(progress, { immediate: true })
          }

          try {
            await knowledgeProcessor.process({
              base,
              item,
              signal,
              runStage,
              onStageChange: handleStageChange,
              onProgress: handleProgress
            })
            await updateStatus('completed', null)
            updateItemProgress(100, { immediate: true })
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              await updateStatus('failed', 'Cancelled')
              logger.info('Knowledge item processing cancelled', { itemId: item.id })
              return
            }

            logger.error('Knowledge item processing failed', error as Error, { itemId: item.id, baseId: base.id })
            await updateStatus('failed', error instanceof Error ? error.message : String(error))
          } finally {
            if (isCurrentJob()) {
              this.jobTokens.delete(item.id)
            }
          }
        })
        .catch((error) => {
          if (error instanceof Error && error.name === 'AbortError') {
            logger.debug('Queue task aborted before start', { itemId: item.id })
            this.jobTokens.delete(item.id)
            return
          }
          logger.error('Failed to enqueue knowledge item', error as Error, { itemId: item.id })
          this.jobTokens.delete(item.id)
        })
    } catch (error) {
      this.jobTokens.delete(item.id)
      logger.error('Knowledge item enqueue failed', error as Error, { itemId: item.id, baseId: base.id })
      await onStatusChange?.('failed', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Cancel processing for an item
   */
  cancel(itemId: string): void {
    knowledgeQueueManager.cancel(itemId)
  }

  /**
   * Clear progress for an item
   */
  clearProgress(itemId: string): void {
    knowledgeQueueManager.clearProgress(itemId)
  }

  /**
   * Remove vectors for an item from the knowledge base
   */
  async removeVectors(base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    try {
      await knowledgeServiceV2.remove({ base, item })
    } catch (error) {
      logger.warn('Failed to remove knowledge item vectors', { itemId: item.id, error })
    }
  }

  /**
   * Check if an item is queued
   */
  isQueued(itemId: string): boolean {
    return knowledgeQueueManager.isQueued(itemId)
  }

  /**
   * Check if an item is being processed
   */
  isProcessing(itemId: string): boolean {
    return knowledgeQueueManager.isProcessing(itemId)
  }

  /**
   * Get progress for an item
   */
  getProgress(itemId: string): number | undefined {
    return knowledgeQueueManager.getProgress(itemId)
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return knowledgeQueueManager.getStatus()
  }
}

export const knowledgeOrchestrator = new KnowledgeOrchestrator()
