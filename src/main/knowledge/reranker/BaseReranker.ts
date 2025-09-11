import { DEFAULT_DOCUMENT_COUNT, DEFAULT_RELEVANT_SCORE } from '@main/utils/knowledge'
import { KnowledgeBaseParams, KnowledgeSearchResult } from '@types'

import { MultiModalDocument, RerankStrategy } from './strategies/RerankStrategy'
import { StrategyFactory } from './strategies/StrategyFactory'

export default abstract class BaseReranker {
  protected base: KnowledgeBaseParams
  protected strategy: RerankStrategy

  constructor(base: KnowledgeBaseParams) {
    if (!base.rerankApiClient) {
      throw new Error('Rerank model is required')
    }
    this.base = base
    this.strategy = StrategyFactory.createStrategy(base.rerankApiClient.provider)
  }
  abstract rerank(query: string, searchResults: KnowledgeSearchResult[]): Promise<KnowledgeSearchResult[]>
  protected getRerankUrl(): string {
    return this.strategy.buildUrl(this.base.rerankApiClient?.baseURL)
  }
  protected getRerankRequestBody(query: string, searchResults: KnowledgeSearchResult[]) {
    const documents = this.buildDocuments(searchResults)
    const topN = this.base.documentCount ?? DEFAULT_DOCUMENT_COUNT
    const model = this.base.rerankApiClient?.model
    return this.strategy.buildRequestBody(query, documents, topN, model)
  }
  private buildDocuments(searchResults: KnowledgeSearchResult[]): MultiModalDocument[] {
    return searchResults.map((doc) => {
      const document: MultiModalDocument = {}

      // 检查是否是图片类型，添加图片内容
      if (doc.metadata?.type === 'image') {
        document.image = doc.pageContent
      } else {
        document.text = doc.pageContent
      }

      return document
    })
  }
  protected extractRerankResult(data: any) {
    return this.strategy.extractResults(data)
  }

  /**
   * Get Rerank Result
   * @param searchResults
   * @param rerankResults
   * @protected
   */
  protected getRerankResult(
    searchResults: KnowledgeSearchResult[],
    rerankResults: Array<{ index: number; relevance_score: number }>
  ) {
    const resultMap = new Map(
      rerankResults.map((result) => [result.index, result.relevance_score || DEFAULT_RELEVANT_SCORE])
    )

    const returenResults = searchResults
      .map((doc: KnowledgeSearchResult, index: number) => {
        const score = resultMap.get(index)
        if (score === undefined) return undefined
        return { ...doc, score }
      })
      .filter((doc): doc is KnowledgeSearchResult => doc !== undefined)
      .sort((a, b) => b.score - a.score)

    return returenResults
  }
  public defaultHeaders() {
    return {
      Authorization: `Bearer ${this.base.rerankApiClient?.apiKey}`,
      'Content-Type': 'application/json'
    }
  }
  protected formatErrorMessage(url: string, error: any, requestBody: any) {
    const errorDetails = {
      url: url,
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      requestBody: requestBody
    }
    return JSON.stringify(errorDetails, null, 2)
  }
}
