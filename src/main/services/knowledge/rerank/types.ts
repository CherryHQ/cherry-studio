export interface RerankRequestInput {
  modelId: string
  query: string
  documents: string[]
  topN: number
}

export interface RerankResult {
  index: number
  relevanceScore: number
}

export interface ResolvedRerankRuntime {
  providerId: string
  modelId: string
  baseUrl: string
  apiKey: string
}

export interface RerankAdapter {
  buildUrl(baseUrl: string): string
  buildHeaders(apiKey: string): Record<string, string>
  buildBody(input: RerankRequestInput): unknown
  parseResponse(data: unknown): RerankResult[]
}
