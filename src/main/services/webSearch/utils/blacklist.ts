import { filterResultsByUrlRules } from '@cherrystudio/web-search/tools/url-filter'
import { loggerService } from '@logger'
import type { WebSearchResponse } from '@shared/data/types/webSearch'

const logger = loggerService.withContext('MainWebSearchBlacklist')

export function filterWebSearchResponseWithBlacklist(
  response: WebSearchResponse,
  blacklistPatterns: string[]
): WebSearchResponse {
  if (!response.results.length || !blacklistPatterns.length) return response
  const { results, diagnostics } = filterResultsByUrlRules(response.results, blacklistPatterns)
  for (const diagnostic of diagnostics) {
    const message =
      diagnostic.kind === 'url'
        ? 'Failed to apply web search blacklist to result URL'
        : diagnostic.kind === 'regex'
          ? 'Invalid web search blacklist regex pattern'
          : 'Invalid web search blacklist match pattern'
    logger.warn(message, { [diagnostic.kind === 'url' ? 'url' : 'pattern']: diagnostic.value, error: diagnostic.error })
  }
  return { ...response, results }
}
