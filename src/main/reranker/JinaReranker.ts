import { ExtractChunkData } from '@llm-tools/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'
import axios from 'axios'

import BaseReranker from './BaseReranker'

export default class JinaReranker extends BaseReranker {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }

  public rerank = async (query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]> => {
    const baseURL = this.base?.rerankBaseURL?.endsWith('/')
      ? this.base.rerankBaseURL.slice(0, -1)
      : this.base.rerankBaseURL
    const url = `${baseURL}/rerank`

    const requestBody = {
      model: this.base.rerankModel,
      query,
      documents: searchResults.map((doc) => doc.pageContent),
      top_n: this.base.topN
    }

    try {
      const { data } = await axios.post(url, requestBody, { headers: this.defaultHeaders() })

      const rerankResults = data.results
      console.log(rerankResults)
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
    } catch (error) {
      console.error('Jina Reranker API 错误:', error)
      throw error
    }
  }
}
