import type { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { TraceMethod } from '@mcp-trace/trace-core'
import { ApiClient } from '@types'

import EmbeddingsFactory from './EmbeddingsFactory'

export default class Embeddings {
  private sdk: BaseEmbeddings
  constructor({ embedApiClient, dimensions }: { embedApiClient: ApiClient; dimensions?: number }) {
    this.sdk = EmbeddingsFactory.create({
      embedApiClient,
      dimensions
    })
  }
  public async init(): Promise<void> {
    return this.sdk.init()
  }

  @TraceMethod({ spanName: 'dimensions', tag: 'Embeddings' })
  public async getDimensions(): Promise<number> {
    return this.sdk.getDimensions()
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
