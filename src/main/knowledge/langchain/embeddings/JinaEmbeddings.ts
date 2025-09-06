import { Embeddings, type EmbeddingsParams } from '@langchain/core/embeddings'
import { chunkArray } from '@langchain/core/utils/chunk_array'
import { getEnvironmentVariable } from '@langchain/core/utils/env'
import { z } from 'zod'

const jinaModelSchema = z.union([
  z.literal('jina-clip-v2'),
  z.literal('jina-embeddings-v3'),
  z.literal('jina-colbert-v2'),
  z.literal('jina-clip-v1'),
  z.literal('jina-colbert-v1-en'),
  z.literal('jina-embeddings-v2-base-es'),
  z.literal('jina-embeddings-v2-base-code'),
  z.literal('jina-embeddings-v2-base-de'),
  z.literal('jina-embeddings-v2-base-zh'),
  z.literal('jina-embeddings-v2-base-en')
])

type JinaModel = z.infer<typeof jinaModelSchema>

export const isJinaEmbeddingsModel = (model: string): model is JinaModel => {
  return jinaModelSchema.safeParse(model).success
}

interface JinaEmbeddingsParams extends EmbeddingsParams {
  /** Model name to use */
  model: JinaModel

  baseUrl?: string

  /**
   * Timeout to use when making requests to Jina.
   */
  timeout?: number

  /**
   * The maximum number of documents to embed in a single request.
   */
  batchSize?: number

  /**
   * Whether to strip new lines from the input text.
   */
  stripNewLines?: boolean

  /**
   * The dimensions of the embedding.
   */
  dimensions?: number

  /**
   * Scales the embedding so its Euclidean (L2) norm becomes 1, preserving direction. Useful when downstream involves dot-product, classification, visualization..
   */
  normalized?: boolean
}

type JinaMultiModelInput =
  | {
      text: string
      image?: never
    }
  | {
      image: string
      text?: never
    }

type JinaEmbeddingsInput = string | JinaMultiModelInput

interface EmbeddingCreateParams {
  model: JinaEmbeddingsParams['model']

  /**
   * input can be strings or JinaMultiModelInputs,if you want embed image,you should use JinaMultiModelInputs
   */
  input: JinaEmbeddingsInput[]
  dimensions: number
  task?: 'retrieval.query' | 'retrieval.passage'
}

interface EmbeddingResponse {
  model: string
  object: string
  usage: {
    total_tokens: number
    prompt_tokens: number
  }
  data: {
    object: string
    index: number
    embedding: number[]
  }[]
}

interface EmbeddingErrorResponse {
  detail: string
}

export class JinaEmbeddings extends Embeddings implements JinaEmbeddingsParams {
  model: JinaEmbeddingsParams['model'] = 'jina-clip-v2'

  batchSize = 24

  baseUrl = 'https://api.jina.ai/v1/embeddings'

  stripNewLines = true

  dimensions = 1024

  apiKey: string

  constructor(
    fields?: Partial<JinaEmbeddingsParams> & {
      apiKey?: string
    }
  ) {
    const fieldsWithDefaults = { maxConcurrency: 2, ...fields }
    super(fieldsWithDefaults)

    const apiKey =
      fieldsWithDefaults?.apiKey || getEnvironmentVariable('JINA_API_KEY') || getEnvironmentVariable('JINA_AUTH_TOKEN')

    if (!apiKey) throw new Error('Jina API key not found')

    this.apiKey = apiKey
    this.baseUrl = fieldsWithDefaults?.baseUrl ? `${fieldsWithDefaults?.baseUrl}embeddings` : this.baseUrl
    this.model = fieldsWithDefaults?.model ?? this.model
    this.dimensions = fieldsWithDefaults?.dimensions ?? this.dimensions
    this.batchSize = fieldsWithDefaults?.batchSize ?? this.batchSize
    this.stripNewLines = fieldsWithDefaults?.stripNewLines ?? this.stripNewLines
  }

  private doStripNewLines(input: JinaEmbeddingsInput[]) {
    if (this.stripNewLines) {
      return input.map((i) => {
        if (typeof i === 'string') {
          return i.replace(/\n/g, ' ')
        }
        if (i.text) {
          return { text: i.text.replace(/\n/g, ' ') }
        }
        return i
      })
    }
    return input
  }

  async embedDocuments(input: JinaEmbeddingsInput[]): Promise<number[][]> {
    const batches = chunkArray(this.doStripNewLines(input), this.batchSize)
    const batchRequests = batches.map((batch) => {
      const params = this.getParams(batch)
      return this.embeddingWithRetry(params)
    })

    const batchResponses = await Promise.all(batchRequests)
    const embeddings: number[][] = []

    for (let i = 0; i < batchResponses.length; i += 1) {
      const batch = batches[i]
      const batchResponse = batchResponses[i] || []
      for (let j = 0; j < batch.length; j += 1) {
        embeddings.push(batchResponse[j])
      }
    }

    return embeddings
  }

  async embedQuery(input: JinaEmbeddingsInput): Promise<number[]> {
    const params = this.getParams(this.doStripNewLines([input]), true)

    const embeddings = (await this.embeddingWithRetry(params)) || [[]]
    return embeddings[0]
  }

  private getParams(input: JinaEmbeddingsInput[], query?: boolean): EmbeddingCreateParams {
    return {
      model: this.model,
      input,
      dimensions: this.dimensions,
      task: query ? 'retrieval.query' : this.model === 'jina-clip-v2' ? undefined : 'retrieval.passage'
    }
  }

  private async embeddingWithRetry(body: EmbeddingCreateParams) {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    })
    const embeddingData: EmbeddingResponse | EmbeddingErrorResponse = await response.json()
    if ('detail' in embeddingData && embeddingData.detail) {
      throw new Error(`${embeddingData.detail}`)
    }
    return (embeddingData as EmbeddingResponse).data.map(({ embedding }) => embedding)
  }
}
