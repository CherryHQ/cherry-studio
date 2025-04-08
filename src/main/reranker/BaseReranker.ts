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

  /**
   * Get Rerank Request Url
   */
  protected getRerankUrl() {
    let baseURL = this.base?.rerankBaseURL?.endsWith('/')
      ? this.base.rerankBaseURL.slice(0, -1)
      : this.base.rerankBaseURL
    // 必须携带/v1，否则会404
    if (baseURL && !baseURL.endsWith('/v1')) {
      baseURL = `${baseURL}/v1`
    }

    return `${baseURL}/rerank`
  }

  /**
   * Get Rerank Result
   * @param searchResults
   * @param rerankResults
   * @protected
   */
  protected getRerankResult(
    searchResults: ExtractChunkData[],
    rerankResults: Array<{
      index: number
      relevance_score: number
    }>
  ) {
    const resultMap = new Map(rerankResults.map((result) => [result.index, result.relevance_score || 0]))

    return searchResults
      .map((doc: ExtractChunkData, index: number) => {
        const score = resultMap.get(index)
        if (score === undefined) return undefined

        return {
          ...doc,
          score
        }
      })
      .filter((doc): doc is ExtractChunkData => doc !== undefined)
      .sort((a, b) => b.score - a.score)
  }

  public defaultHeaders() {
    return {
      Authorization: `Bearer ${this.base.rerankApiKey}`,
      'Content-Type': 'application/json'
    }
  }

  protected formatErrorMessage(url: string, error: any, requestBody: any) {
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
