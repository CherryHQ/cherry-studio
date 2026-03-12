import type { MultiModalDocument, RerankProvider, RerankResultItem } from '../types'
import { isTEIProvider, RERANKER_PROVIDERS } from '../types'

export class TEIProvider implements RerankProvider {
  readonly providerId = RERANKER_PROVIDERS.TEI

  /**
   * Check if this provider handles the given provider ID
   * TEI provider matches any provider containing "tei"
   */
  matches(providerId: string): boolean {
    return isTEIProvider(providerId)
  }

  buildUrl(baseURL?: string): string {
    if (baseURL && baseURL.endsWith('/')) {
      return `${baseURL}rerank`
    }
    if (baseURL && !baseURL.endsWith('/v1')) {
      baseURL = `${baseURL}/v1`
    }
    return `${baseURL}/rerank`
  }

  buildRequestBody(query: string, documents: MultiModalDocument[]) {
    const textDocuments = documents.filter((d) => d.text).map((d) => d.text!)
    return {
      query,
      texts: textDocuments,
      return_text: true
    }
  }

  extractResults(data: unknown): RerankResultItem[] {
    return (data as Array<{ index: number; score: number }>).map((item) => ({
      index: item.index,
      relevance_score: item.score
    }))
  }
}
