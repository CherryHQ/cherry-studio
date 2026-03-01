import type { MultiModalDocument, RerankProvider, RerankResultItem } from '../types'
import { RERANKER_PROVIDERS } from '../types'

export class BailianProvider implements RerankProvider {
  readonly providerId = RERANKER_PROVIDERS.BAILIAN

  buildUrl(): string {
    return 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank'
  }

  buildRequestBody(query: string, documents: MultiModalDocument[], topN: number, model?: string) {
    const textDocuments = documents.filter((d) => d.text).map((d) => d.text!)

    return {
      model,
      input: { query, documents: textDocuments },
      parameters: { top_n: topN }
    }
  }

  extractResults(data: unknown): RerankResultItem[] {
    return (data as { output: { results: RerankResultItem[] } }).output.results
  }
}
