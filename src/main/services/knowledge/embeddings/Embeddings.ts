import { loggerService } from '@logger'
import { TraceMethod } from '@mcp-trace/trace-core'
import { embed, type EmbeddingModel, embedMany } from 'ai'

import { resolveEmbeddingProvider } from './registry'
import type { EmbeddingProvider, EmbeddingProviderOptions, EmbeddingsConfig } from './types'

const logger = loggerService.withContext('Embeddings')
const DEFAULT_BATCH_SIZE = 10

/**
 * Main embedding class for generating vector embeddings
 * Public API remains unchanged for backward compatibility
 */
export default class Embeddings {
  private readonly model: EmbeddingModel<string>
  private readonly dimensions?: number
  private readonly providerId: string
  private readonly modelId: string
  private readonly provider: EmbeddingProvider
  private resolvedDimensions?: number

  constructor({ embedApiClient, dimensions }: EmbeddingsConfig) {
    this.dimensions = dimensions
    this.providerId = embedApiClient.provider
    this.modelId = embedApiClient.model
    this.provider = resolveEmbeddingProvider(embedApiClient)
    this.model = this.provider.createModel(embedApiClient)
  }

  public async init(): Promise<void> {
    return
  }

  @TraceMethod({ spanName: 'dimensions', tag: 'Embeddings' })
  public async getDimensions(): Promise<number> {
    if (this.dimensions) {
      return this.dimensions
    }
    if (this.resolvedDimensions) {
      return this.resolvedDimensions
    }
    const embedding = await this.embedQuery('dimension probe')
    this.resolvedDimensions = embedding.length
    return this.resolvedDimensions
  }

  @TraceMethod({ spanName: 'embedDocuments', tag: 'Embeddings' })
  public async embedDocuments(texts: string[], onProgress?: (progress: number) => void): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }
    const vectors: number[][] = []
    const providerOptions = this.buildProviderOptions()
    const totalBatches = Math.ceil(texts.length / DEFAULT_BATCH_SIZE)
    logger.debug(`[Embeddings] Starting embedDocuments: ${texts.length} texts in ${totalBatches} batches`)

    for (let i = 0; i < texts.length; i += DEFAULT_BATCH_SIZE) {
      const batchIndex = Math.floor(i / DEFAULT_BATCH_SIZE) + 1
      const batch = texts.slice(i, i + DEFAULT_BATCH_SIZE)
      const batchStartTime = Date.now()
      logger.debug(`[Embeddings] [BATCH ${batchIndex}/${totalBatches}] Starting, size: ${batch.length}`)

      try {
        const result = await embedMany({
          model: this.model,
          values: batch,
          providerOptions
        })
        vectors.push(...result.embeddings)

        const batchDuration = Date.now() - batchStartTime
        logger.debug(`[Embeddings] [BATCH ${batchIndex}/${totalBatches}] Completed in ${batchDuration}ms`)

        // Report progress after each batch (0-100 range for embedding phase)
        const progress = Math.round((vectors.length / texts.length) * 100)
        onProgress?.(progress)
      } catch (error) {
        const batchDuration = Date.now() - batchStartTime
        logger.error(`[Embeddings] [BATCH ${batchIndex}/${totalBatches}] Failed after ${batchDuration}ms`, {
          provider: this.providerId,
          model: this.modelId,
          batchStart: i,
          batchSize: batch.length,
          error
        })
        throw new Error('Embedding documents failed', { cause: error })
      }
    }
    logger.debug(`[Embeddings] embedDocuments completed: ${vectors.length} vectors`)
    return vectors
  }

  @TraceMethod({ spanName: 'embedQuery', tag: 'Embeddings' })
  public async embedQuery(text: string): Promise<number[]> {
    try {
      const result = await embed({
        model: this.model,
        value: text,
        providerOptions: this.buildProviderOptions()
      })
      return result.embedding
    } catch (error) {
      logger.error('Embedding query failed', {
        provider: this.providerId,
        model: this.modelId,
        error
      })
      throw new Error('Embedding query failed', { cause: error })
    }
  }

  private buildProviderOptions(): EmbeddingProviderOptions {
    return this.provider.buildProviderOptions(this.dimensions)
  }
}
