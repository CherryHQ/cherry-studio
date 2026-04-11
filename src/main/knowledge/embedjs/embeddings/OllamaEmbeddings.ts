import { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { net } from 'electron'

interface OllamaEmbeddingsConfig {
  model: string
  baseUrl: string
  dimensions?: number
  keepAlive?: string | number
  truncate?: boolean
  requestOptions?: Record<string, unknown>
  headers?: Record<string, string>
}

export class OllamaEmbeddings extends BaseEmbeddings {
  private readonly model: string
  private readonly baseUrl: string
  private readonly dimensions?: number
  private readonly keepAlive?: string | number
  private readonly truncate: boolean
  private readonly requestOptions?: Record<string, unknown>
  private readonly headers?: Record<string, string>

  constructor(configuration: OllamaEmbeddingsConfig) {
    super()

    this.model = configuration.model
    this.baseUrl = configuration.baseUrl
    this.dimensions = configuration.dimensions
    this.keepAlive = configuration.keepAlive
    this.truncate = configuration.truncate ?? false
    this.requestOptions = configuration.requestOptions
    this.headers = configuration.headers
  }

  override async getDimensions(): Promise<number> {
    if (this.dimensions !== undefined) {
      return this.dimensions
    }

    const embeddings = await this.embedDocuments(['sample'])
    const sampleEmbedding = embeddings[0]

    if (!sampleEmbedding?.length) {
      throw new Error('Ollama embedding response did not include an embedding vector')
    }

    return sampleEmbedding.length
  }

  override async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embed(texts)
  }

  override async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.embed([text])
    const embedding = embeddings[0]

    if (!embedding?.length) {
      throw new Error('Ollama embedding response did not include an embedding vector')
    }

    return embedding
  }

  private async embed(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.post('/api/embed', {
        model: this.model,
        input: texts.length === 1 ? texts[0] : texts,
        keep_alive: this.keepAlive,
        truncate: this.truncate,
        dimensions: this.dimensions,
        options: this.requestOptions
      })

      return this.normalizeEmbeddings(response)
    } catch (currentApiError) {
      try {
        return await Promise.all(texts.map((text) => this.embedWithLegacyApi(text)))
      } catch (legacyApiError) {
        throw new Error('Ollama embeddings request failed using both /api/embed and legacy /api/embeddings', {
          cause: legacyApiError instanceof Error ? legacyApiError : (currentApiError as Error)
        })
      }
    }
  }

  private async embedWithLegacyApi(text: string): Promise<number[]> {
    const response = await this.post('/api/embeddings', {
      model: this.model,
      prompt: text,
      keep_alive: this.keepAlive,
      options: this.requestOptions
    })

    const embeddings = this.normalizeEmbeddings(response)
    const embedding = embeddings[0]

    if (!embedding?.length) {
      throw new Error('Ollama legacy embeddings response did not include an embedding vector')
    }

    return embedding
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await net.fetch(new URL(path, this.baseUrl).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Ollama request failed with status ${response.status}`)
    }

    return response.json()
  }

  private normalizeEmbeddings(response: unknown): number[][] {
    const currentEmbeddings = (response as { embeddings?: unknown })?.embeddings
    if (this.isEmbeddingMatrix(currentEmbeddings) && currentEmbeddings.length > 0) {
      return currentEmbeddings
    }

    const legacyEmbedding = (response as { embedding?: unknown })?.embedding
    if (this.isEmbeddingVector(legacyEmbedding) && legacyEmbedding.length > 0) {
      return [legacyEmbedding]
    }

    throw new Error('Ollama embedding response did not include embeddings')
  }

  private isEmbeddingMatrix(value: unknown): value is number[][] {
    return Array.isArray(value) && value.every((item) => this.isEmbeddingVector(item))
  }

  private isEmbeddingVector(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'number')
  }
}
