import type { ExtractChunkData } from '@llm-tools/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'

import BaseReranker from './BaseReranker'
import RerankerFactory from './RerankerFactory'

export default class Reranker {
  private sdk: BaseReranker
  constructor(base: KnowledgeBaseParams) {
    this.sdk = RerankerFactory.create(base)
  }
  public async rerank(query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]> {
    return this.sdk.rerank(query, searchResults)
  }
}
