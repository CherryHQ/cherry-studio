import { JinaEmbeddings } from '@langchain/community/embeddings/jina'
import { TraceMethod } from '@mcp-trace/trace-core'
import { ApiClient } from '@types'

import EmbeddingsFactory from './EmbeddingsFactory'

export type MultiModalEmbeddingInput =
  | {
      text: string
      image?: never
    }
  | {
      image: string
      text?: never
    }

export default class MultiModalEmbeddings {
  private sdk: JinaEmbeddings
  public provider: string
  constructor({ embedApiClient, dimensions }: { embedApiClient: ApiClient; dimensions?: number }) {
    this.sdk = EmbeddingsFactory.create({
      embedApiClient,
      dimensions
    }) as JinaEmbeddings
    this.provider = embedApiClient.provider
  }

  @TraceMethod({ spanName: 'embedDocuments', tag: 'Embeddings' })
  public async embedDocuments(inputs: MultiModalEmbeddingInput[]): Promise<number[][]> {
    return this.sdk.embedDocuments(inputs)
  }

  @TraceMethod({ spanName: 'embedQuery', tag: 'Embeddings' })
  public async embedQuery(text: string): Promise<number[]> {
    return this.sdk.embedQuery(text)
  }
}
