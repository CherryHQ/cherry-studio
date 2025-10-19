import { KnowledgeBaseParams, KnowledgeSearchResult } from '@types'
import { net } from 'electron'

import BaseReranker from './BaseReranker'
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
        let errorBody: any
        try {
          errorBody = await response.json()
        } catch {
          // If response body is not JSON, try to read as text
          try {
            errorBody = await response.text()
          } catch {
            errorBody = null
          }
        }

        const error = new Error(`HTTP ${response.status}: ${response.statusText}`)
        // Attach response details to the error object for formatErrorMessage
        ;(error as any).response = {
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
