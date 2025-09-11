import { MultiModalDocument, RerankStrategy } from './RerankStrategy'
export class BailianStrategy implements RerankStrategy {
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
  extractResults(data: any) {
    return data.output.results
  }
}
