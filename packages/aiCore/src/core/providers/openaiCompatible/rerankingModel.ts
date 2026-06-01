import type { OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible'
import type { RerankingModelV3 } from '@ai-sdk/provider'
import {
  combineHeaders,
  createStatusCodeErrorResponseHandler,
  type FetchFunction,
  postJsonToApi,
  withoutTrailingSlash
} from '@ai-sdk/provider-utils'

export type OpenAICompatibleRerankingModelSettings = Pick<
  OpenAICompatibleProviderSettings,
  'name' | 'baseURL' | 'apiKey' | 'headers' | 'queryParams' | 'fetch'
>

export type OpenAICompatibleRerankingModelConfig = {
  provider: string
  url: (options: { path: string; modelId: string }) => string
  headers: () => Record<string, string>
  fetch?: FetchFunction
}

type DoRerankOptions = Parameters<RerankingModelV3['doRerank']>[0]
type DoRerankResult = Awaited<ReturnType<RerankingModelV3['doRerank']>>
type RerankRanking = DoRerankResult['ranking']

type OpenAICompatibleRerankResponseItem = {
  index: number
  relevance_score: number
}

type OpenAICompatibleRerankResponse = {
  results?: OpenAICompatibleRerankResponseItem[]
}

export class OpenAICompatibleRerankingModel implements RerankingModelV3 {
  readonly specificationVersion = 'v3'

  constructor(
    readonly modelId: string,
    private readonly config: OpenAICompatibleRerankingModelConfig
  ) {}

  get provider(): string {
    return this.config.provider
  }

  async doRerank({ documents, headers, query, topN, abortSignal }: DoRerankOptions): Promise<DoRerankResult> {
    if (documents.type !== 'text') {
      throw new Error('OpenAI-compatible reranking model only supports text documents')
    }

    const { value, rawValue } = await postJsonToApi({
      url: this.config.url({ path: '/rerank', modelId: this.modelId }),
      headers: combineHeaders(this.config.headers(), headers),
      body: {
        model: this.modelId,
        query,
        documents: documents.values,
        top_n: topN
      },
      failedResponseHandler: createStatusCodeErrorResponseHandler(),
      successfulResponseHandler: async ({ response }) => {
        const rawValue = await response.json()
        return {
          value: parseRerankResponse(rawValue),
          rawValue
        }
      },
      abortSignal,
      fetch: this.config.fetch
    })

    return {
      ranking: value,
      response: {
        body: rawValue
      }
    }
  }
}

function parseRerankResponse(body: unknown): RerankRanking {
  const results = (body as OpenAICompatibleRerankResponse).results
  if (!Array.isArray(results)) {
    throw new Error('Rerank response must contain a results array')
  }

  return results.map((result) => {
    if (typeof result.index !== 'number' || typeof result.relevance_score !== 'number') {
      throw new Error('Rerank response results must contain numeric index and relevance_score')
    }
    return { index: result.index, relevanceScore: result.relevance_score }
  })
}

export function createOpenAICompatibleRerankingModel(
  modelId: string,
  settings: OpenAICompatibleRerankingModelSettings
): RerankingModelV3 {
  const baseURL = withoutTrailingSlash(settings.baseURL)
  if (!baseURL) {
    throw new Error('OpenAI-compatible reranking model requires baseURL')
  }

  return new OpenAICompatibleRerankingModel(modelId, {
    provider: `${settings.name}.rerank`,
    url: ({ path }) => {
      const url = new URL(`${baseURL}${path}`)
      if (settings.queryParams) {
        url.search = new URLSearchParams(settings.queryParams).toString()
      }
      return url.toString()
    },
    headers: () => ({
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      ...settings.headers
    }),
    fetch: settings.fetch
  })
}
