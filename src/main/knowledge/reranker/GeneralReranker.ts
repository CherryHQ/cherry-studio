import { KnowledgeBaseParams, KnowledgeSearchResult } from '@types'
import { net } from 'electron'

import BaseReranker from './BaseReranker'

interface RerankError extends Error {
  response?: {
    status: number
    statusText: string
    body?: unknown
  }
}

export default class GeneralReranker extends BaseReranker {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }
  public rerank = async (query: string, searchResults: KnowledgeSearchResult[]): Promise<KnowledgeSearchResult[]> => {
    const url = this.getRerankUrl()
    const requestBody = this.getRerankRequestBody(query, searchResults)
    try {
      const response = await net.fetch(url, {
        method: 'POST',
        headers: this.defaultHeaders(),
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        // Read the response body to get detailed error information
        // Clone the response to avoid consuming the body multiple times
        const clonedResponse = response.clone()
        let errorBody: unknown

        try {
          errorBody = await clonedResponse.json()
        } catch {
          // If response body is not JSON, try to read as text
          try {
            errorBody = await response.text()
          } catch {
            errorBody = null
          }
        }

        const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as RerankError
        // Attach response details to the error object for formatErrorMessage
        error.response = {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        }
        throw error
      }

      const data = await response.json()

      const rerankResults = this.extractRerankResult(data)
      return this.getRerankResult(searchResults, rerankResults)
    } catch (error: any) {
      const errorDetails = this.formatErrorMessage(url, error, requestBody)
      throw new Error(`重排序请求失败: ${error.message}\n请求详情: ${errorDetails}`)
    }
  }
}
