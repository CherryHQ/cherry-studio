import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'

export default abstract class BaseReranker {
  protected base: KnowledgeBaseParams

  constructor(base: KnowledgeBaseParams) {
    if (!base.rerankApiClient) {
      throw new Error('Rerank model is required')
    }
    this.base = base
  }

  abstract rerank(query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]>

  /**
   * Get Rerank Request Url
   */
  protected getRerankUrl() {
    if (this.base.rerankApiClient?.provider === 'bailian') {
      return 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank'
    }

    let baseURL = this.base.rerankApiClient?.baseURL

    if (baseURL && baseURL.endsWith('/')) {
      // `/` 结尾强制使用rerankBaseURL
      return `${baseURL}rerank`
    }

    if (baseURL && !baseURL.endsWith('/v1')) {
      baseURL = `${baseURL}/v1`
    }

    return `${baseURL}/rerank`
  }

  /**
   * Get Rerank Request Body
   */
  protected getRerankRequestBody(query: string, searchResults: ExtractChunkData[]) {
    const provider = this.base.rerankApiClient?.provider
    const documents = searchResults.map((doc) => doc.pageContent)
    const topN = this.base.documentCount

    if (provider === 'voyageai') {
      return {
        model: this.base.rerankApiClient?.model,
        query,
        documents,
        top_k: topN
      }
    } else if (provider === 'bailian') {
      return {
        model: this.base.rerankApiClient?.model,
        input: {
          query,
          documents
        },
        parameters: {
          top_n: topN
        }
      }
    } else if (provider?.includes('tei')) {
      return {
        query,
        texts: documents,
        return_text: true
      }
    } else {
      return {
        model: this.base.rerankApiClient?.model,
        query,
        documents,
        top_n: topN
      }
    }
  }

  /**
   * Extract Rerank Result
   */
  protected extractRerankResult(data: any) {
    const provider = this.base.rerankApiClient?.provider
    if (provider === 'bailian') {
      return data.output.results
    } else if (provider === 'voyageai') {
      return data.data
    } else if (provider?.includes('tei')) {
      return data.map((item: any) => {
        return {
          index: item.index,
          relevance_score: item.score
        }
      })
    } else {
      return data.results
    }
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
      Authorization: `Bearer ${this.base.rerankApiClient?.apiKey}`,
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
