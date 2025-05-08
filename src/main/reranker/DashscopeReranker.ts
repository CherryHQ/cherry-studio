import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import axiosProxy from '@main/services/AxiosProxy'
import { KnowledgeBaseParams } from '@types'

import BaseReranker from './BaseReranker'

interface DashscopeRerankResultItem {
  document: {
    text: string
  }
  index: number
  relevance_score: number
}

interface DashscopeRerankResponse {
  output: {
    results: DashscopeRerankResultItem[]
  }
  usage: {
    total_tokens: number
  }
  request_id: string
}

export default class DashscopeReranker extends BaseReranker {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }

  public rerank = async (query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]> => {
    const url = 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank'

    const requestBody = {
      model: this.base.rerankModel,
      input: {
        query,
        documents: searchResults.map((doc) => doc.pageContent)
      },
      parameters: {
        return_documents: true, // Recommended to be true to get document details if needed, though scores are primary
        top_n: this.base.topN || 5 // Default to 5 if topN is not specified, as per API example
      }
    }

    try {
      const { data } = await axiosProxy.axios.post<DashscopeRerankResponse>(url, requestBody, {
        headers: this.defaultHeaders()
      })

      const rerankResults = data.output.results
      return this.getRerankResult(searchResults, rerankResults)
    } catch (error: any) {
      const errorDetails = this.formatErrorMessage(url, error, requestBody)
      console.error('Dashscope Reranker API 错误:', errorDetails)
      throw new Error(`重排序请求失败: ${error.message}\n请求详情: ${errorDetails}`)
    }
  }
}
