import { loggerService } from '@logger'
import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResponse
} from '@shared/data/types/webSearch'
import { net } from 'electron'

export abstract class BaseWebSearchProvider {
  private static lastUsedKeyByProvider = new Map<ResolvedWebSearchProvider['id'], string>()
  protected readonly logger

  constructor(protected readonly provider: ResolvedWebSearchProvider) {
    this.logger = loggerService.withContext(`WebSearchProvider:${provider.id}`)
  }

  abstract search(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse>

  async check(httpOptions?: RequestInit): Promise<void> {
    await this.search(this.getCheckQuery(), this.createCheckConfig(), httpOptions)
  }

  protected assertNonEmptyQuery(query: string) {
    if (!query.trim()) {
      throw new Error('Search query cannot be empty')
    }
  }

  protected requireApiHost(): string {
    const host = this.provider.apiHost?.trim()
    if (!host) {
      throw new Error(`API host is required for provider ${this.provider.id}`)
    }
    return host
  }

  protected resolveApiUrl(path: string): string {
    const apiHost = this.requireApiHost()
    const normalizedBaseUrl = apiHost.endsWith('/') ? apiHost : `${apiHost}/`
    const normalizedPath = path.replace(/^\//, '')
    return new URL(normalizedPath, normalizedBaseUrl).toString()
  }

  protected getApiKey(required: boolean = true): string {
    const rawApiKey = this.provider.apiKey?.trim() || ''
    const keys = rawApiKey
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)

    if (keys.length === 0) {
      if (required) {
        throw new Error(`API key is required for provider ${this.provider.id}`)
      }
      return ''
    }

    if (keys.length === 1) {
      return keys[0]
    }

    const keyName = this.provider.id
    const lastUsedKey = BaseWebSearchProvider.lastUsedKeyByProvider.get(keyName)
    const currentIndex = lastUsedKey ? keys.indexOf(lastUsedKey) : -1
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]

    BaseWebSearchProvider.lastUsedKeyByProvider.set(keyName, nextKey)
    return nextKey
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

  protected netFetch(url: string, init?: RequestInit) {
    return net.fetch(url, init)
  }

  protected getCheckQuery(): string {
    return 'Cherry Studio'
  }

  protected createCheckConfig(): WebSearchExecutionConfig {
    return {
      searchWithTime: false,
      maxResults: 1,
      excludeDomains: [],
      compression: {
        method: 'none',
        cutoffLimit: null,
        cutoffUnit: 'char',
        ragDocumentCount: 5,
        ragEmbeddingModelId: null,
        ragEmbeddingDimensions: null,
        ragRerankModelId: null
      }
    }
  }
}
