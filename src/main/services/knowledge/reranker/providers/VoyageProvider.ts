import type { MultiModalDocument, RerankProvider, RerankResultItem } from '../types'
import { RERANKER_PROVIDERS } from '../types'

export class VoyageAIProvider implements RerankProvider {
  readonly providerId = RERANKER_PROVIDERS.VOYAGEAI

  buildUrl(baseURL?: string): string {
    if (baseURL && baseURL.endsWith('/')) {
      return `${baseURL}rerank`
    }
    if (baseURL && !baseURL.endsWith('/v1')) {
      baseURL = `${baseURL}/v1`
    }
    return `${baseURL}/rerank`
  }

  buildRequestBody(query: string, documents: MultiModalDocument[], topN: number, model?: string) {
    const textDocuments = documents.filter((d) => d.text).map((d) => d.text!)
    return {
      model,
      query,
      documents: textDocuments,
      top_k: topN
    }
  }

  extractResults(data: unknown): RerankResultItem[] {
    return (data as { data: RerankResultItem[] }).data
  }
}
