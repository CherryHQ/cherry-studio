import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'
import axios from 'axios'

import BaseReranker from './BaseReranker'

export default class SiliconFlowReranker extends BaseReranker {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }

  public rerank = async (query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]> => {
    const url = this.getRerankUrl()

    const requestBody = {
      model: this.base.rerankModel,
      query,
      documents: searchResults.map((doc) => doc.pageContent),
      top_n: this.base.topN,
      max_chunks_per_doc: this.base.chunkSize,
      overlap_tokens: this.base.chunkOverlap
    }

    try {
      const { data } = await axios.post(url, requestBody, { headers: this.defaultHeaders() })

      const rerankResults = data.results
      return this.getRerankResult(searchResults, rerankResults)
    } catch (error: any) {
      const errorDetails = this.formatErrorMessage(url, error, requestBody)

      console.error('SiliconFlow Reranker API 错误:', errorDetails)
      throw new Error(`重排序请求失败: ${error.message}\n请求详情: ${errorDetails}`)
    }
  }
}
