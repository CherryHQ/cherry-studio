import type { ExtractChunkData } from '@llm-tools/embedjs-interfaces'
import { KnowledgeBaseParams } from '@types'
import axios from 'axios'

import BaseReranker from './BaseReranker'

export default class SiliconFlowReranker extends BaseReranker {
  constructor(base: KnowledgeBaseParams) {
    super(base)
  }

  public rerank = async (query: string, searchResults: ExtractChunkData[]): Promise<ExtractChunkData[]> => {
    const url = `${this.base.baseURL}/rerank`

    const { data } = await axios.post(
      url,
      {
        model: this.base.rerankModel,
        query,
        documents: searchResults.map((doc) => doc.pageContent),
        top_n: this.base.topN,
        max_chunks_per_doc: this.base.chunkSize,
        overlap_tokens: this.base.chunkOverlap
      },
      {
        headers: this.defaultHeaders()
      }
    )

    const rerankResults = data.results
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
  }
}
