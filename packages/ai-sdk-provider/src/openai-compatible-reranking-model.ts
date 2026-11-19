import type { OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible'
import type { RerankingModelV3 } from '@ai-sdk/provider'
import {
  combineHeaders,
  createStatusCodeErrorResponseHandler,
  type FetchFunction,
  postJsonToApi,
  withoutTrailingSlash
} from '@ai-sdk/provider-utils'

type HeaderValue = string | undefined

export type OpenAICompatibleRerankingModelSettings = Pick<
  OpenAICompatibleProviderSettings,
  'name' | 'baseURL' | 'apiKey' | 'headers' | 'queryParams' | 'fetch'
>

export type OpenAICompatibleRerankingModelConfig = {
  provider: string
  url: (options: { path: string; modelId: string }) => string
  headers: () => Record<string, HeaderValue>
  fetch?: FetchFunction
}

type DoRerankOptions = Parameters<RerankingModelV3['doRerank']>[0]
type DoRerankResult = Awaited<ReturnType<RerankingModelV3['doRerank']>>
type RerankRanking = DoRerankResult['ranking']

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
          value: parseRerankResponse(rawValue, documents.values.length),
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- HTTP response.json yields unvalidated provider data; verify the envelope, document indices and finite scores before constructing SDK ranking output.
function parseRerankResponse(body: unknown, documentCount: number): RerankRanking {
  if (typeof body !== 'object' || body === null || !('results' in body) || !Array.isArray(body.results)) {
    throw new Error('Rerank response must contain a results array')
  }
  const results: readonly unknown[] = body.results

  return results.map((result) => {
    if (typeof result !== 'object' || result === null) {
      throw new Error('Rerank response results must be objects')
    }

    if (
      !('index' in result) ||
      !('relevance_score' in result) ||
      typeof result.index !== 'number' ||
      typeof result.relevance_score !== 'number'
    ) {
      throw new Error('Rerank response results must contain numeric index and relevance_score')
    }

    if (!Number.isFinite(result.relevance_score)) {
      throw new Error('Rerank response relevance_score must be finite')
    }

    if (!Number.isInteger(result.index) || result.index < 0 || result.index >= documentCount) {
      throw new Error('Rerank response results must reference a valid document index')
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
    headers: () => {
      const headers: Partial<Pick<NonNullable<typeof settings.headers>, 'Authorization'>> = {}
      if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`
      return { ...headers, ...settings.headers }
    },
    fetch: settings.fetch
  })
}
