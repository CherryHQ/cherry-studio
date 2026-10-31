import { filterResultsByUrlRules } from '@cherrystudio/web-search/tools/url-filter'
import { loggerService } from '@logger'
import type { WebSearchResponse } from '@shared/data/types/webSearch'
import { parseMatchPattern } from '@shared/utils/blacklistMatchPattern'

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

/**
 * Maps blacklist rules to the bare domains that provider-side site exclusion accepts.
 * Only `*://*.domain/*` rules qualify; every other rule is still applied locally to the results.
 */
export function toExcludedSiteDomains(blacklistPatterns: readonly string[]): string[] {
  return blacklistPatterns.flatMap((rule) => {
    const pattern = parseMatchPattern(rule.trim())
    return pattern &&
      !pattern.allURLs &&
      pattern.scheme === '*' &&
      pattern.path === '/*' &&
      pattern.host.startsWith('*.')
      ? [pattern.host.slice(2)]
      : []
  })
}
