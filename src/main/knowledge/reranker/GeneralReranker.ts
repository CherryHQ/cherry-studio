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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
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
