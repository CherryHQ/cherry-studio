import { loggerService } from '@logger'
import { knowledgeBaseService } from '@main/data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@main/data/services/KnowledgeItemService'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import { DocumentChunker } from './chunking/DocumentChunker'
import { DocumentEmbedder } from './embedding/DocumentEmbedder'
import { EmbeddingModelFactory } from './embedding/EmbeddingModelFactory'
import { ReaderFactory } from './readers/ReaderFactory'
import { VectorStoreFactory } from './vectorstore/VectorStoreFactory'

const logger = loggerService.withContext('KnowledgeExecutionService')

export type KnowledgeExecutionStage = 'file_processing_submit' | 'file_processing_poll' | 'embed'

export interface KnowledgeExecutionTask {
  itemId: string
  baseId: string
  stage: KnowledgeExecutionStage
  readyAt: number
}

export type KnowledgeExecutionResult = { type: 'completed' } | { type: 'failed'; error: string }

export class KnowledgeExecutionService {
  async execute(task: KnowledgeExecutionTask): Promise<KnowledgeExecutionResult> {
    switch (task.stage) {
      case 'file_processing_submit':
        return await this.submitFileProcessing(task)
      case 'file_processing_poll':
        return await this.pollFileProcessing(task)
      case 'embed':
        return await this.embed(task)
    }
  }

  async submitFileProcessing(task: KnowledgeExecutionTask): Promise<KnowledgeExecutionResult> {
    logger.error(`task ${task.stage}`)
    throw new Error('not implement')
  }

  async pollFileProcessing(task: KnowledgeExecutionTask): Promise<KnowledgeExecutionResult> {
    logger.error(`task ${task.stage}`)
    throw new Error('not implement')
  }

  async embed(task: KnowledgeExecutionTask): Promise<KnowledgeExecutionResult> {
    let item: KnowledgeItem | null = null

    try {
      const [base, loadedItem] = await Promise.all([
        knowledgeBaseService.getById(task.baseId),
        knowledgeItemService.getById(task.itemId)
      ])

      item = loadedItem

      if (item.baseId !== base.id) {
        throw new Error(`Knowledge item ${item.id} does not belong to knowledge base ${base.id}`)
      }

      await knowledgeItemService.update(item.id, {
        status: 'embed',
        error: null
      })

      const reader = ReaderFactory.create(item)
      const documents = await reader.load(item)
      const chunks = DocumentChunker.chunk(base, item, documents)
      const embeddingModel = EmbeddingModelFactory.create(base)
      const nodes = await DocumentEmbedder.embed(embeddingModel, chunks)

      if (nodes.length > 0) {
        const vectorStore = VectorStoreFactory.create(base)
        await vectorStore.add(nodes)
      }

      await knowledgeItemService.update(item.id, {
        status: 'completed',
        error: null
      })

      logger.info('Knowledge item embed completed', {
        baseId: base.id,
        itemId: item.id,
        documentCount: documents.length,
        chunkCount: chunks.length,
        nodeCount: nodes.length
      })

      return { type: 'completed' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      logger.error(
        'Knowledge item embed failed',
        error instanceof Error ? error : new Error(message),
        item ? { itemId: item.id, baseId: task.baseId } : { itemId: task.itemId, baseId: task.baseId }
      )

      if (item) {
        try {
          await knowledgeItemService.update(item.id, {
            status: 'failed',
            error: message
          })
        } catch (updateError) {
          logger.error(
            'Failed to persist knowledge item failure state',
            updateError instanceof Error ? updateError : new Error(String(updateError)),
            { itemId: item.id, baseId: task.baseId }
          )
        }
      }

      return {
        type: 'failed',
        error: message
      }
    }
  }
}

export const knowledgeExecutionService = new KnowledgeExecutionService()
