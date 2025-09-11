import { MultiModalDocument, RerankStrategy } from './RerankStrategy'
export class DefaultStrategy implements RerankStrategy {
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
      top_n: topN
    }
  }
  extractResults(data: any) {
    return data.results
  }
}
