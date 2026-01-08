export interface MultiModalDocument {
  text?: string
  image?: string
}
export interface RerankStrategy {
  buildUrl(baseURL?: string): string
  buildRequestBody(query: string, documents: MultiModalDocument[], topN: number, model?: string): any
  extractResults(data: any): Array<{ index: number; relevance_score: number }>
}
