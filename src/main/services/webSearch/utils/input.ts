import { isValidUrl } from '@shared/utils'

export function normalizeWebSearchKeywords(keywords: string[]): string[] {
  const normalized = keywords.map((keyword) => keyword.trim()).filter(Boolean)

  if (normalized.length === 0) {
    throw new Error('At least one web search keyword is required')
  }

  return normalized
}

export function normalizeWebSearchUrls(urls: string[]): string[] {
  const normalized = urls.map((url) => url.trim()).filter(Boolean)

  if (normalized.length === 0) {
    throw new Error('At least one URL is required')
  }

  const invalidUrl = normalized.find((url) => !isValidUrl(url))
  if (invalidUrl) {
    throw new Error(`Invalid URL format: ${invalidUrl}`)
  }

  return normalized
}
