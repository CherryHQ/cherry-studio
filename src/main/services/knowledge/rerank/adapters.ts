import * as z from 'zod'

import type { RerankAdapter, RerankRequestInput, RerankResult } from './types'

const OPENAI_COMPATIBLE_RERANK_SUFFIX = '/rerank'
const OPENAI_COMPATIBLE_V1_SUFFIX = '/v1'
const BAILIAN_RERANK_URL = 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank'

const RerankResultItemSchema = z.object({
  index: z.number(),
  relevance_score: z.number().optional(),
  score: z.number().optional()
})

const OpenAiCompatibleRerankResponseSchema = z.object({
  results: z.array(RerankResultItemSchema)
})

const VoyageRerankResponseSchema = z.object({
  data: z.array(RerankResultItemSchema)
})

const TeiRerankResponseSchema = z.array(RerankResultItemSchema)

const BailianRerankResponseSchema = z.object({
  output: z.object({
    results: z.array(RerankResultItemSchema)
  })
})

function parseResults(items: z.infer<typeof RerankResultItemSchema>[]) {
  return items.map((item) => ({
    index: item.index,
    relevanceScore: item.relevance_score ?? item.score ?? 0
  }))
}

function buildOpenAiCompatibleUrl(baseUrl: string): string {
  if (baseUrl.endsWith('/')) {
    return `${baseUrl}rerank`
  }

  if (!baseUrl.endsWith(OPENAI_COMPATIBLE_V1_SUFFIX)) {
    return `${baseUrl}${OPENAI_COMPATIBLE_V1_SUFFIX}${OPENAI_COMPATIBLE_RERANK_SUFFIX}`
  }

  return `${baseUrl}${OPENAI_COMPATIBLE_RERANK_SUFFIX}`
}

function defaultHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
}

const defaultAdapter: RerankAdapter = {
  buildUrl: buildOpenAiCompatibleUrl,
  buildHeaders: defaultHeaders,
  buildBody({ modelId, query, documents, topN }: RerankRequestInput) {
    return {
      model: modelId,
      query,
      documents,
      top_n: topN
    }
  },
  parseResponse(data: unknown): RerankResult[] {
    return parseResults(OpenAiCompatibleRerankResponseSchema.parse(data).results)
  }
}

const jinaAdapter: RerankAdapter = {
  ...defaultAdapter,
  buildBody({ modelId, query, documents, topN }: RerankRequestInput) {
    return {
      model: modelId,
      query,
      documents,
      top_n: topN
    }
  }
}

const voyageAdapter: RerankAdapter = {
  ...defaultAdapter,
  buildBody({ modelId, query, documents, topN }: RerankRequestInput) {
    return {
      model: modelId,
      query,
      documents,
      top_k: topN
    }
  },
  parseResponse(data: unknown): RerankResult[] {
    return parseResults(VoyageRerankResponseSchema.parse(data).data)
  }
}

const teiAdapter: RerankAdapter = {
  ...defaultAdapter,
  buildBody({ query, documents }: RerankRequestInput) {
    return {
      query,
      texts: documents,
      return_text: true
    }
  },
  parseResponse(data: unknown): RerankResult[] {
    return parseResults(TeiRerankResponseSchema.parse(data))
  }
}

const bailianAdapter: RerankAdapter = {
  ...defaultAdapter,
  buildUrl() {
    return BAILIAN_RERANK_URL
  },
  buildBody({ modelId, query, documents, topN }: RerankRequestInput) {
    return {
      model: modelId,
      input: {
        query,
        documents
      },
      parameters: {
        top_n: topN
      }
    }
  },
  parseResponse(data: unknown): RerankResult[] {
    return parseResults(BailianRerankResponseSchema.parse(data).output.results)
  }
}

export function getRerankAdapter(providerId: string): RerankAdapter {
  switch (providerId) {
    case 'jina':
      return jinaAdapter
    case 'voyageai':
      return voyageAdapter
    case 'bailian':
      return bailianAdapter
    default:
      if (providerId.includes('tei')) {
        return teiAdapter
      }

      return defaultAdapter
  }
}
