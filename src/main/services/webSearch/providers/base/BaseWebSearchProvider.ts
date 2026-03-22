import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResponse
} from '@shared/data/types/webSearch'
import { withoutTrailingSlash } from '@shared/utils'

const lastUsedKeyByProvider = new Map<ResolvedWebSearchProvider['id'], string>()

export function resolveProviderApiHost(provider: ResolvedWebSearchProvider): string {
  const host = provider.apiHost?.trim()
  if (!host) {
    throw new Error(`API host is required for provider ${provider.id}`)
  }
  return host
}

export function resolveProviderApiKey(provider: ResolvedWebSearchProvider, required: boolean = true): string {
  const rawApiKey = provider.apiKey?.trim() || ''
  const keys = rawApiKey
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)

  if (keys.length === 0) {
    if (required) {
      throw new Error(`API key is required for provider ${provider.id}`)
    }
    return ''
  }

  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = lastUsedKeyByProvider.get(provider.id)
  const currentIndex = lastUsedKey ? keys.indexOf(lastUsedKey) : -1
  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]

  lastUsedKeyByProvider.set(provider.id, nextKey)
  return nextKey
}

export abstract class BaseWebSearchProvider {
  constructor(protected readonly provider: ResolvedWebSearchProvider) {}

  abstract search(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse>

  protected resolveApiUrl(path: string): string {
    const apiHost = resolveProviderApiHost(this.provider)
    const normalizedBaseUrl = `${withoutTrailingSlash(apiHost)}/`
    const normalizedPath = path.replace(/^\//, '')
    return new URL(normalizedPath, normalizedBaseUrl).toString()
  }

  protected defaultHeaders() {
    return {
      'HTTP-Referer': 'https://cherry-ai.com',
      'X-Title': 'Cherry Studio'
    }
  }

  protected getBasicAuthHeaders(): Record<string, string> {
    if (!this.provider.basicAuthUsername) {
      return {}
    }

    return {
      Authorization: `Basic ${Buffer.from(
        `${this.provider.basicAuthUsername}:${this.provider.basicAuthPassword}`
      ).toString('base64')}`
    }
  }
}
