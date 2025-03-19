import type { ExtractChunkData } from '@llm-tools/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'

export default abstract class BaseReranker {
  protected base: KnowledgeBaseParams
  constructor(base: KnowledgeBaseParams) {
    if (!base.rerankModel) {
      throw new Error('Rerank model is required')
    }
    this.base = base
  }
  abstract rerank(query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]>

  public defaultHeaders() {
    return {
      Authorization: `Bearer ${this.base.apiKey}`,
      'Content-Type': 'application/json'
    }
  }
}
