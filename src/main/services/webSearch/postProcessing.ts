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

/**
 * Upper bound on total output characters regardless of token estimation.
 * tokenx treats an arbitrarily long numeric segment as one token, so a
 * numeric-table page can escape token-based slicing.  This ceiling is a
 * safety net that keeps the merged payload inside LLM context limits.
 */
const HARD_CHARACTER_CEILING = 400_000

function applyCutoff(results: WebSearchResult[], config: WebSearchCompressionConfig): WebSearchResult[] {
  if (!config.cutoffLimit) {
    return results
  }

  const totalContentLength = results.reduce((sum, result) => sum + result.content.length, 0)
  if (totalContentLength <= config.cutoffLimit) {
    return results
  }

  const perResultLimit = Math.max(1, Math.floor(config.cutoffLimit / results.length))

  let trimmed = results.map((result) => {
    const sliced = sliceByTokens(result.content, 0, perResultLimit)
    return {
      ...result,
      content: sliced.length < result.content.length ? `${sliced}...` : sliced
    }
  })

  // Enforce the hard character ceiling after token-based trimming.  If the
  // total still exceeds it (e.g. long numeric runs that tokenx undercounts),
  // fall back to a character-length proportioned split.
  const trimmedLength = trimmed.reduce((sum, result) => sum + result.content.length, 0)
  if (trimmedLength > HARD_CHARACTER_CEILING) {
    const charPerResult = Math.max(1, Math.floor(HARD_CHARACTER_CEILING / trimmed.length))
    trimmed = trimmed.map((result) => {
      if (result.content.length <= charPerResult) {
        return result
      }
      return {
        ...result,
        content: `${result.content.slice(0, charPerResult)}...`
      }
    })
  }

  return trimmed
}
