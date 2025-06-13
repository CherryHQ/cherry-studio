import type { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { TraceMethod } from '@mcp-trace/trace-core'
import { KnowledgeBaseParams } from '@types'

import EmbeddingsFactory from './EmbeddingsFactory'

export default class Embeddings {
  private sdk: BaseEmbeddings
  constructor({ model, apiKey, apiVersion, baseURL, dimensions }: KnowledgeBaseParams) {
    this.sdk = EmbeddingsFactory.create({ model, apiKey, apiVersion, baseURL, dimensions } as KnowledgeBaseParams)
  }
  public async init(): Promise<void> {
    return this.sdk.init()
  }

  @TraceMethod({ spanName: 'getDimensions', tag: 'Embeddings' })
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
