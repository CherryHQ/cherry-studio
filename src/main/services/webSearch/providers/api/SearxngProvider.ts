import { net } from 'electron'
import * as z from 'zod'

import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { isHttpUrl } from '@shared/utils/url'

import { fetchSearchResultContents } from '../../utils/fetchContent'
import { resolveProviderApiHost } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import { executeRemoteProvider } from '../remoteWebSearchClient'

const SearxngConfigResponseSchema = z.object({
  engines: z.array(
    z.object({
      enabled: z.boolean(),
      categories: z.array(z.string()),
      name: z.string()
    })
  )
})

function trimStringList(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

export class SearxngProvider extends BaseWebSearchProvider {
  private getBasicAuthHeaders(): Record<string, string> {
    const basicAuthUsername = this.provider.basicAuthUsername.trim()
    if (!basicAuthUsername) {
      return {}
    }
    const basicAuthPassword = this.provider.basicAuthPassword.trim()

    return {
      Authorization: `Basic ${Buffer.from(`${basicAuthUsername}:${basicAuthPassword}`).toString('base64')}`
    }
  }

  private async resolveEngines(signal?: AbortSignal): Promise<string[]> {
    const configuredEngines = trimStringList(this.provider.engines)
    if (configuredEngines.length > 0) {
      return configuredEngines
    }

    const requestUrl = this.resolveApiUrl('searchKeywords', '/config')
    const response = await net.fetch(requestUrl, {
      method: 'GET',
      headers: {
        ...defaultAppHeaders(),
        ...this.getBasicAuthHeaders()
      },
      signal
    })

    if (!response.ok) {
      await this.throwHttpError('Searxng config failed', response)
    }

    const payload = await this.parseJsonResponse(response, SearxngConfigResponseSchema, {
      operation: 'config',
      requestUrl
    })

    const engines = payload.engines
      .filter((engine) => engine.enabled && engine.categories.includes('general'))
      .sort((left, right) => Number(right.categories.includes('web')) - Number(left.categories.includes('web')))
      .map((engine) => engine.name)

    if (engines.length === 0) {
      throw new Error('No enabled general web search engines found in Searxng configuration')
    }

    return engines
  }

  async searchKeywords(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const signal = httpOptions?.signal ?? undefined
    const engines = await this.resolveEngines(signal)
    const response = await executeRemoteProvider({
      providerId: 'searxng',
      capability: 'searchKeywords',
      input: query,
      apiHost: resolveProviderApiHost(this.provider, 'searchKeywords'),
      credentials: {
        basicAuthUsername: this.provider.basicAuthUsername.trim(),
        basicAuthPassword: this.provider.basicAuthPassword.trim()
      },
      engines,
      maxResults: config.maxResults,
      signal
    })
    const validItems = response.results.filter((item) => isHttpUrl(item.url)).slice(0, config.maxResults)
    const results = await fetchSearchResultContents(
      validItems.map((item) => item.url),
      {
        query,
        providerLabel: 'Searxng',
        signal,
        getFallbackResult: (_url, index) => {
          const item = validItems[index]
          return item.content ? { ...item, title: item.title || item.url, sourceInput: item.url } : undefined
        }
      }
    )
    return { ...response, results: results.map((result) => ({ ...result, sourceInput: query })) }
  }
}
