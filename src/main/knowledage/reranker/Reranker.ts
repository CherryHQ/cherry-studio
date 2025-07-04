import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'

import GeneralReranker from './GeneralReranker'

export default class Reranker {
  private sdk: GeneralReranker
  constructor(base: KnowledgeBaseParams) {
    this.sdk = new GeneralReranker(base)
  }
  public async rerank(query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]> {
    return this.sdk.rerank(query, searchResults)
  }
}
