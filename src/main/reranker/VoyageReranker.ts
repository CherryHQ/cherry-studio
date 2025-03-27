import { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'
import axios from 'axios'

import BaseReranker from './BaseReranker'

export default class VoyageReranker extends BaseReranker {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }

  public rerank = async (query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]> => {
    let baseURL = this.base?.rerankBaseURL?.endsWith('/')
      ? this.base.rerankBaseURL.slice(0, -1)
      : this.base.rerankBaseURL

    if (baseURL && !baseURL.endsWith('/v1')) {
      baseURL = `${baseURL}/v1`
    }

    const url = `${baseURL}/rerank`

    const requestBody = {
      model: this.base.rerankModel,
      query,
      documents: searchResults.map((doc) => doc.pageContent),
      top_k: this.base.topN,
      return_documents: false,
      truncation: true
    }

    try {
      const { data } = await axios.post(url, requestBody, {
        headers: {
          ...this.defaultHeaders()
        }
      })

      const rerankResults = data.data

      const resultMap = new Map(rerankResults.map((result: any) => [result.index, result.relevance_score || 0]))

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
    } catch (error: any) {
      const errorDetails = this.formatErrorMessage(url, error, requestBody)

      console.error('Voyage Reranker API Error:', errorDetails)
      throw new Error(`重排序请求失败: ${error.message}\n请求详情: ${errorDetails}`)
    }
  }
}
