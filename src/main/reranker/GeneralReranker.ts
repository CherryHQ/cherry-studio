import { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import AxiosProxy from '@main/services/AxiosProxy'
import { KnowledgeBaseParams } from '@types'

import BaseReranker from './BaseReranker'

export default class GeneralReranker extends BaseReranker {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }

  public rerank = async (query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]> => {
    const url = this.getRerankUrl()

    const requestBody = this.getRerankRequestBody(query, searchResults)

    try {
      const { data } = await AxiosProxy.axios.post(url, requestBody, { headers: this.defaultHeaders() })

      const rerankResults = this.extractRerankResult(data)
      return this.getRerankResult(searchResults, rerankResults)
    } catch (error: any) {
      const errorDetails = this.formatErrorMessage(url, error, requestBody)
      throw new Error(`重排序请求失败: ${error.message}\n请求详情: ${errorDetails}`)
    }
  }
}
