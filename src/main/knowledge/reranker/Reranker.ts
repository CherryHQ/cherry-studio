import { KnowledgeBaseParams, KnowledgeSearchResult } from '@types'

import GeneralReranker from './GeneralReranker'

export default class Reranker {
  private sdk: GeneralReranker
  constructor(base: KnowledgeBaseParams) {
    this.sdk = new GeneralReranker(base)
  }
  public async rerank(query: string, searchResults: KnowledgeSearchResult[]): Promise<KnowledgeSearchResult[]> {
    return this.sdk.rerank(query, searchResults)
  }
}
