import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
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
      Authorization: `Bearer ${this.base.rerankApiKey}`,
      'Content-Type': 'application/json'
    }
  }

  public formatErrorMessage(url: string, error: any, requestBody: any) {
    const errorDetails = {
      url: url,
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      requestBody: requestBody
    }
    return JSON.stringify(errorDetails, null, 2)
  }
}
