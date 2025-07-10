import type { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'

import EmbeddingsFactory from './EmbeddingsFactory'
import { SUPPORTED_DIM_MODELS as VOYAGE_SUPPORTED_DIM_MODELS } from './VoyageEmbeddings'

export default class Embeddings {
  private sdk: BaseEmbeddings
  constructor({ model, provider, apiKey, apiVersion, baseURL, dimensions }: KnowledgeBaseParams) {
    // FIXME: 只应对了Voyage，更通用的方法是外部维护一个支持设置dimensions参数的模型列表
    let newDimensions = dimensions
    if (provider === 'voyageai' && !VOYAGE_SUPPORTED_DIM_MODELS.includes(model)) {
      newDimensions = undefined
    }
    this.sdk = EmbeddingsFactory.create({
      model,
      provider,
      apiKey,
      apiVersion,
      baseURL,
      dimensions: newDimensions
    } as KnowledgeBaseParams)
  }
  public async init(): Promise<void> {
    return this.sdk.init()
  }
  public async getDimensions(): Promise<number> {
    return this.sdk.getDimensions()
  }
  public async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.sdk.embedDocuments(texts)
  }

  public async embedQuery(text: string): Promise<number[]> {
    return this.sdk.embedQuery(text)
  }
}
