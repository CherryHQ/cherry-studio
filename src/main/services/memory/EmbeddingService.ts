import Embeddings from '@main/embeddings/Embeddings'

export interface EmbeddingOptions {
  model: string
  provider: string
  apiKey: string
  apiVersion?: string
  baseURL: string
  dimensions?: number
  batchSize?: number
}

export interface EmbeddingResult {
  embedding: number[]
  dimensions: number
  modelId: string
}

export interface BatchEmbeddingResult {
  embeddings: number[][]
  dimensions: number
  modelId: string
  processedCount: number
}

export class EmbeddingService {
  private cache = new Map<string, { embedding: number[]; timestamp: number }>()
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours
  private readonly MAX_CACHE_SIZE = 10000

  /**
   * Generate embedding for a single text
   */
  public async generateEmbedding(text: string, options: EmbeddingOptions): Promise<EmbeddingResult> {
    // Check cache first
    const cacheKey = this.getCacheKey(text, options.model)
    const cached = this.cache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return {
        embedding: cached.embedding,
        dimensions: cached.embedding.length,
        modelId: options.model
      }
    }

    try {
      const embedding = await this.callEmbeddingAPI(text, options)

      // Cache the result
      this.setCacheEntry(cacheKey, embedding)

      return {
        embedding,
        dimensions: embedding.length,
        modelId: options.model
      }
    } catch (error) {
      console.error('Embedding generation failed:', error)
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Generate embeddings for multiple texts in batches
   */
  public async generateBatchEmbeddings(texts: string[], options: EmbeddingOptions): Promise<BatchEmbeddingResult> {
    const { batchSize = 100 } = options
    const embeddings: number[][] = []
    let processedCount = 0

    // Check cache for existing embeddings
    const uncachedTexts: string[] = []
    const cachedResults: { [index: number]: number[] } = {}

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      const cacheKey = this.getCacheKey(text, options.model)
      const cached = this.cache.get(cacheKey)

      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        cachedResults[i] = cached.embedding
        processedCount++
      } else {
        uncachedTexts.push(text)
      }
    }

    // Process uncached texts in batches
    if (uncachedTexts.length > 0) {
      for (let i = 0; i < uncachedTexts.length; i += batchSize) {
        const batch = uncachedTexts.slice(i, i + batchSize)
        const batchEmbeddings = await this.processBatch(batch, options)

        // Cache batch results
        for (let j = 0; j < batch.length; j++) {
          const text = batch[j]
          const embedding = batchEmbeddings[j]
          const cacheKey = this.getCacheKey(text, options.model)
          this.setCacheEntry(cacheKey, embedding)
        }

        processedCount += batch.length
      }

      // Rebuild complete results array
      for (let i = 0; i < texts.length; i++) {
        if (cachedResults[i]) {
          embeddings[i] = cachedResults[i]
        } else {
          const cacheKey = this.getCacheKey(texts[i], options.model)
          const cached = this.cache.get(cacheKey)
          embeddings[i] = cached!.embedding
        }
      }
    } else {
      // All results were cached
      for (let i = 0; i < texts.length; i++) {
        embeddings[i] = cachedResults[i]
      }
    }

    return {
      embeddings,
      dimensions: embeddings[0]?.length || 0,
      modelId: options.model,
      processedCount
    }
  }

  /**
   * Call the embedding API using the existing embeddings infrastructure
   */
  private async callEmbeddingAPI(text: string, options: EmbeddingOptions): Promise<number[]> {
    try {
      const embeddings = new Embeddings({
        id: 'temp-id',
        model: options.model,
        provider: options.provider,
        apiKey: options.apiKey,
        apiVersion: options.apiVersion,
        baseURL: options.baseURL,
        dimensions: options.dimensions || this.getModelDimensions(options.model)
      })

      await embeddings.init()
      return await embeddings.embedQuery(text)
    } catch (error) {
      console.error('Embedding generation failed:', error)
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Process a batch of texts for embedding using the existing infrastructure
   */
  private async processBatch(texts: string[], options: EmbeddingOptions): Promise<number[][]> {
    try {
      const embeddings = new Embeddings({
        id: 'temp-id',
        model: options.model,
        provider: options.provider,
        apiKey: options.apiKey,
        apiVersion: options.apiVersion,
        baseURL: options.baseURL,
        dimensions: options.dimensions || this.getModelDimensions(options.model)
      })

      await embeddings.init()
      return await embeddings.embedDocuments(texts)
    } catch (error) {
      console.error('Batch embedding generation failed:', error)
      throw new Error(
        `Failed to generate batch embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Generate cache key for text and model
   */
  private getCacheKey(text: string, modelId: string): string {
    // Create a simple hash of text and model for caching
    const combined = `${text}:${modelId}`
    let hash = 0
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return `emb_${hash.toString(36)}`
  }

  /**
   * Set cache entry with size management
   */
  private setCacheEntry(key: string, embedding: number[]): void {
    // Clean old entries if cache is full
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, {
      embedding,
      timestamp: Date.now()
    })
  }

  /**
   * Clear expired cache entries
   */
  public clearExpiredCache(): void {
    const now = Date.now()
    const expiredKeys: string[] = []

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        expiredKeys.push(key)
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key)
    }
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0 // TODO: Implement hit rate tracking
    }
  }

  /**
   * Clear all cached embeddings
   */
  public clearCache(): void {
    this.cache.clear()
  }

  /**
   * Validate embedding dimensions match expected dimensions
   */
  public validateDimensions(embedding: number[], expectedDimensions?: number): boolean {
    if (!expectedDimensions) return true
    return embedding.length === expectedDimensions
  }

  /**
   * Get default embedding models for different providers
   */
  public static getDefaultEmbeddingModels(): { [provider: string]: string } {
    return {
      openai: 'text-embedding-3-small',
      ollama: 'nomic-embed-text'
    }
  }

  /**
   * Get recommended dimensions for embedding models
   */
  private getModelDimensions(modelId: string): number {
    const dimensionMap: { [key: string]: number } = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
      'nomic-embed-text': 768,
      'mxbai-embed-large': 1024
    }

    return dimensionMap[modelId] || 1536 // Default to OpenAI standard
  }

  /**
   * Get recommended dimensions for embedding models (static version)
   */
  public static getModelDimensions(modelId: string): number {
    const dimensionMap: { [key: string]: number } = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
      'nomic-embed-text': 768,
      'mxbai-embed-large': 1024
    }

    return dimensionMap[modelId] || 1536 // Default to OpenAI standard
  }
}
