import { TraceMethod } from '@mcp-trace/trace-core'
import { ApiClient } from '@types'

import EmbeddingsFactory from './EmbeddingsFactory'
import { JinaEmbeddings } from './JinaEmbeddings'

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
    const sdk = EmbeddingsFactory.create({
      embedApiClient,
      dimensions
    })
    if (sdk instanceof JinaEmbeddings) {
      this.sdk = sdk
    } else {
      throw new Error('Only JinaEmbeddings is supported')
    }
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
