import type { Embeddings as BaseEmbeddings } from '@langchain/core/embeddings'
import { TraceMethod } from '@mcp-trace/trace-core'
import { ApiClient } from '@types'

import EmbeddingsFactory from './EmbeddingsFactory'

export default class TextEmbeddings {
  private sdk: BaseEmbeddings
  constructor({ embedApiClient, dimensions }: { embedApiClient: ApiClient; dimensions?: number }) {
    this.sdk = EmbeddingsFactory.create({
      embedApiClient,
      dimensions
    })
  }

  @TraceMethod({ spanName: 'embedDocuments', tag: 'Embeddings' })
  public async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.sdk.embedDocuments(texts)
  }

  @TraceMethod({ spanName: 'embedQuery', tag: 'Embeddings' })
  public async embedQuery(text: string): Promise<number[]> {
    return this.sdk.embedQuery(text)
  }
}
