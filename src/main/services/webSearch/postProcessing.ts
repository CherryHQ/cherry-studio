import type {
  WebSearchCompressionConfig,
  WebSearchExecutionConfig,
  WebSearchResponse,
  WebSearchResult
} from '@shared/data/types/webSearch'
import { sliceByTokens } from 'tokenx'

export type WebSearchPostProcessingResult = {
  response: WebSearchResponse
}

/**
 * Applies result-level post processing after provider execution and blacklist filtering.
 *
 * This module intentionally stays pure: it only transforms the response from
 * compression config. Request lifecycle behavior is orchestrated by
 * `WebSearchService`.
 *
 * Current behavior:
 * - `none`: return raw results
 * - `cutoff`: truncate result content
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
      response: {
        ...response,
        results: applyCutoff(response.results, runtimeConfig.compression)
      }
    }
  }

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
