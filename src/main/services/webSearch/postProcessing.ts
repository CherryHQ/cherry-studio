import type {
  WebSearchCompressionConfig,
  WebSearchExecutionConfig,
  WebSearchResponse,
  WebSearchResult,
  WebSearchStatus
} from '@shared/data/types/webSearch'
import { sliceByTokens } from 'tokenx'

export type WebSearchPostProcessingResult = {
  response: WebSearchResponse
  status?: WebSearchStatus
}

/**
 * Applies result-level post processing after provider execution and blacklist filtering.
 *
 * This module intentionally stays pure: it only transforms the response from
 * compression config and does not own request lifecycle side effects such as
 * status writes. Lifecycle phases like `cutoff` and future `rag*` states are
 * orchestrated by `WebSearchService`.
 *
 * Current behavior:
 * - `none`: return raw results
 * - `cutoff`: truncate result content
 * - `rag`: reserved for future Main-side implementation, currently returns raw results
 */
export async function postProcessWebSearchResponse(
  response: WebSearchResponse,
  runtimeConfig: WebSearchExecutionConfig
): Promise<WebSearchPostProcessingResult> {
  if (response.results.length <= 0) {
    return { response }
  }

  if (runtimeConfig.compression.method === 'cutoff') {
    return {
      status: { phase: 'cutoff' },
      response: {
        ...response,
        results: applyCutoff(response.results, runtimeConfig.compression)
      }
    }
  }

  if (runtimeConfig.compression.method === 'rag') {
    return applyRag(response, runtimeConfig)
  }

  return { response }
}

async function applyRag(
  response: WebSearchResponse,
  runtimeConfig: WebSearchExecutionConfig
): Promise<WebSearchPostProcessingResult> {
  void runtimeConfig
  // TODO: implement Main-side RAG compression and lifecycle status handling.
  return { response }
}

function applyCutoff(results: WebSearchResult[], config: WebSearchCompressionConfig): WebSearchResult[] {
  if (!config.cutoffLimit) {
    return results
  }

  const perResultLimit = Math.max(1, Math.floor(config.cutoffLimit / results.length))

  return results.map((result) => {
    if (config.cutoffUnit === 'token') {
      const sliced = sliceByTokens(result.content, 0, perResultLimit)
      return {
        ...result,
        content: sliced.length < result.content.length ? `${sliced}...` : sliced
      }
    }

    return {
      ...result,
      content: result.content.length > perResultLimit ? `${result.content.slice(0, perResultLimit)}...` : result.content
    }
  })
}
