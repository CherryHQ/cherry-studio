import { filterResultsByUrlRules } from '@cherrystudio/web-search/tools/url-filter'
import { loggerService } from '@logger'
import type { WebSearchBlacklistSubscription } from '@shared/data/preference/preferenceTypes'
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
 * Merges manual `exclude_domains` with the cached rules of every subscription,
 * deduplicated. Manual rules come first and are never removed by a refresh;
 * with no subscriptions the manual list is returned unchanged.
 */
export function mergeWebSearchBlacklist(
  excludeDomains: readonly string[],
  subscriptions: readonly WebSearchBlacklistSubscription[]
): string[] {
  if (!subscriptions.length) return [...excludeDomains]

  const merged = [...excludeDomains]
  const seen = new Set(excludeDomains)
  for (const subscription of subscriptions) {
    for (const rule of subscription.rules) {
      if (seen.has(rule)) continue
      seen.add(rule)
      merged.push(rule)
    }
  }
  return merged
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
