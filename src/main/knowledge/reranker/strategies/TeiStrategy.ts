import { MultiModalDocument, RerankStrategy } from './RerankStrategy'
export class TEIStrategy implements RerankStrategy {
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
  extractResults(data: any) {
    return data.map((item: any) => ({
      index: item.index,
      relevance_score: item.score
    }))
  }
}
