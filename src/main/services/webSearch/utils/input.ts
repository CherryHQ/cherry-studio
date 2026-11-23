import { isHttpUrl } from '@shared/utils/url'

export const MAX_WEB_SEARCH_INPUTS = 20

export function normalizeWebSearchKeywords(keywords: string[]): string[] {
  // Free-form search terms are valid inputs; URL-only constraints belong to fetchUrls.
  // Guard against non-string elements (e.g. null/undefined from malformed tool calls)
  // so that .trim() never throws TypeError.
  const normalized = keywords
    .flatMap((keyword) => (typeof keyword === 'string' ? [keyword.trim()] : []))
    .filter(Boolean)

  if (normalized.length === 0) {
    throw new Error('At least one web search keyword is required')
  }

  if (normalized.length > MAX_WEB_SEARCH_INPUTS) {
    throw new Error(`Web search supports at most ${MAX_WEB_SEARCH_INPUTS} inputs per request`)
  }

  return normalized
}

export function normalizeWebSearchUrls(urls: string[]): string[] {
  const normalized = urls.flatMap((url) => {
    const value = url.trim()

    return value ? [value] : []
  })

  if (normalized.length === 0) {
    throw new Error('At least one URL is required')
  }

  if (normalized.length > MAX_WEB_SEARCH_INPUTS) {
    throw new Error(`Web search supports at most ${MAX_WEB_SEARCH_INPUTS} inputs per request`)
  }

  const invalidUrls = normalized.filter((url) => !isHttpUrl(url))

  if (invalidUrls.length > 0) {
    throw new Error(`Invalid URL format: ${invalidUrls.join(', ')}`)
  }

  return normalized
}
