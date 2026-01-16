/**
 * KnowledgeProcessor - Knowledge Item Processing Pipeline
 *
 * Encapsulates the complete processing workflow for knowledge items:
 * - OCR preprocessing (placeholder for future implementation)
 * - Content reading via type-specific readers
 * - Embedding generation and vector storage
 *
 * This processor is called by the Orchestrator and runs within the QueueManager's
 * concurrency control context.
 */

import { loggerService } from '@logger'
import type { KnowledgeBase, KnowledgeItem, KnowledgeItemType } from '@shared/data/types/knowledge'

import { embedNodes } from './embeddings/EmbeddingPipeline'
import { knowledgeProviderAdapter } from './KnowledgeProviderAdapter'
import { knowledgeServiceV2 } from './KnowledgeServiceV2'
import { getReader } from './readers'
import type { KnowledgeStage, KnowledgeStageRunner, ReaderContext } from './types'

const logger = loggerService.withContext('KnowledgeProcessor')

/**
 * Options for processing a knowledge item
 */
export interface ProcessOptions {
  /** Knowledge base configuration */
  base: KnowledgeBase
  /** Item to process */
  item: KnowledgeItem
  /** Optional user ID for preprocessing services */
  userId?: string
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Stage runner for concurrency control (provided by QueueManager) */
  runStage: KnowledgeStageRunner
  /** Callback when processing stage changes */
  onStageChange?: (stage: KnowledgeStage) => void
  /** Callback for progress updates (0-100) */
  onProgress?: (progress: number) => void
}

/**
 * Options for direct processing (without queue management)
 */
export interface DirectProcessOptions {
  /** Knowledge base configuration */
  base: KnowledgeBase
  /** Item to process */
  item: KnowledgeItem
  /** Optional user ID for preprocessing services */
  userId?: string
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * KnowledgeProcessor handles the complete processing pipeline for knowledge items
 */
class KnowledgeProcessor {
  /**
   * Default stage runner that executes tasks directly without concurrency control.
   * Used for direct processing without queue management.
   */
  private defaultRunStage: KnowledgeStageRunner = async <T>(_stage: KnowledgeStage, task: () => Promise<T>) => {
    return await task()
  }

  /**
   * Process a knowledge item directly without queue management.
   *
   * This is a convenience method for cases where queue management is not needed,
   * such as IPC handlers or one-off processing tasks.
   *
   * @param options - Direct processing options (without runStage)
   */
  async processDirect(options: DirectProcessOptions): Promise<void> {
    return this.process({
      ...options,
      runStage: this.defaultRunStage
    })
  }

  /**
   * Process a knowledge item through all stages
   *
   * Pipeline:
   * 1. OCR stage - Document preprocessing (placeholder)
   * 2. Read stage - Content extraction and chunking
   * 3. Embed stage - Vector generation and storage
   */
  async process(options: ProcessOptions): Promise<void> {
    const { base, item, userId = '', signal, runStage, onStageChange, onProgress } = options
    const itemType = item.type as KnowledgeItemType

    logger.info(`[Processor] Starting process: type=${itemType}, base=${base.id}, item=${item.id}`)

    // Validate reader exists for this type
    const reader = getReader(itemType)
    if (!reader) {
      logger.warn(`[Processor] No reader for type: ${itemType}`)
      throw new Error(`Unsupported item type: ${itemType}`)
    }

    // Resolve base configuration with embedding provider details
    const resolvedBase = await knowledgeProviderAdapter.buildBaseParams(base, 'embeddingModelId')

    // Create reader context
    const context: ReaderContext = {
      base: resolvedBase,
      item,
      userId
    }

    // ========================================================================
    // Stage 1: OCR Preprocessing
    // ========================================================================
    onStageChange?.('ocr')
    await runStage('ocr', async () => {
      // TODO: Implement actual OCR processing when needed
      // This stage is a placeholder for future PDF parsing, image recognition, etc.
      logger.debug(`[Processor] OCR stage completed (placeholder) for item ${item.id}`)
    })

    // ========================================================================
    // Stage 2: Content Reading
    // ========================================================================
    onStageChange?.('read')
    const nodes = await runStage('read', async () => {
      const result = await reader.read(context)
      logger.debug(`[Processor] Read stage completed: ${result.nodes.length} nodes for item ${item.id}`)
      return result.nodes
    })

    if (nodes.length === 0) {
      logger.warn(`[Processor] No content read for item ${item.id}`)
      return
    }

    // ========================================================================
    // Stage 3: Embedding and Storage
    // ========================================================================
    onStageChange?.('embed')
    await runStage('embed', async () => {
      // Generate embeddings for all nodes
      const embeddedNodes = await embedNodes(nodes, resolvedBase, onProgress, signal)

      // Store in vector database
      await knowledgeServiceV2.addNodes({
        base,
        nodes: embeddedNodes
      })

      logger.debug(`[Processor] Embed stage completed: ${embeddedNodes.length} nodes stored for item ${item.id}`)
    })

    logger.info(`[Processor] Process completed for item ${item.id}`)
  }
}

export const knowledgeProcessor = new KnowledgeProcessor()
