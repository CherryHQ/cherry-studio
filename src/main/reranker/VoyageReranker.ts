import { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import axiosProxy from '@main/services/AxiosProxy'
import { KnowledgeBaseParams } from '@types'

import BaseReranker from './BaseReranker'

export default class VoyageReranker extends BaseReranker {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }

  public rerank = async (query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]> => {
    const url = this.getRerankUrl()

    const requestBody = {
      model: this.base.rerankModel,
      query,
      documents: searchResults.map((doc) => doc.pageContent),
      top_k: this.base.topN,
      return_documents: false,
      truncation: true
    }

    try {
      const { data } = await axiosProxy.axios.post(url, requestBody, {
        headers: {
          ...this.defaultHeaders()
        }
      })

      const rerankResults = data.data
      return this.getRerankResult(searchResults, rerankResults)
    } catch (error: any) {
      const errorDetails = this.formatErrorMessage(url, error, requestBody)

      console.error('Voyage Reranker API Error:', errorDetails)
      throw new Error(`重排序请求失败: ${error.message}\n请求详情: ${errorDetails}`)
    }
  }
}
