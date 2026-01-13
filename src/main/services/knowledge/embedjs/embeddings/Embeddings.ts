import { loggerService } from '@logger'
import { TraceMethod } from '@mcp-trace/trace-core'
import type { ApiClient } from '@types'
import { embed, type EmbeddingModel, embedMany } from 'ai'

import type { EmbeddingProvider, EmbeddingProviderOptions } from './EmbeddingProviders'
import { resolveEmbeddingProvider } from './EmbeddingProviders'

const logger = loggerService.withContext('Embeddings')
const DEFAULT_BATCH_SIZE = 10

export default class Embeddings {
  private readonly model: EmbeddingModel<string>
  private readonly dimensions?: number
  private readonly providerId: string
  private readonly modelId: string
  private readonly provider: EmbeddingProvider
  private resolvedDimensions?: number

  constructor({ embedApiClient, dimensions }: { embedApiClient: ApiClient; dimensions?: number }) {
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
  public async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }
    const vectors: number[][] = []
    const providerOptions = this.buildProviderOptions()
    for (let i = 0; i < texts.length; i += DEFAULT_BATCH_SIZE) {
      const batch = texts.slice(i, i + DEFAULT_BATCH_SIZE)
      try {
        const result = await embedMany({
          model: this.model,
          values: batch,
          providerOptions
        })
        vectors.push(...result.embeddings)
      } catch (error) {
        logger.error('Embedding documents failed', {
          provider: this.providerId,
          model: this.modelId,
          batchStart: i,
          batchSize: batch.length,
          error
        })
        throw new Error('Embedding documents failed', { cause: error })
      }
    }
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
