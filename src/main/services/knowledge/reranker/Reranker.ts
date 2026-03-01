import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'

import type { ResolvedKnowledgeBase } from '../KnowledgeProviderAdapter'
import GeneralReranker from './GeneralReranker'

export default class Reranker {
  private sdk: GeneralReranker
  constructor(base: ResolvedKnowledgeBase) {
    this.sdk = new GeneralReranker(base)
  }
  public async rerank(query: string, searchResults: KnowledgeSearchResult[]): Promise<KnowledgeSearchResult[]> {
    return this.sdk.rerank(query, searchResults)
  }
}
