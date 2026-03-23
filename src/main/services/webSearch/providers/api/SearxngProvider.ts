import type { WebSearchExecutionConfig, WebSearchResponse, WebSearchResult } from '@shared/data/types/webSearch'
import { defaultAppHeaders, isValidUrl } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { fetchWebSearchContent } from '../../utils/fetchContent'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { UrlSearchContext } from '../base/context'

const SearxngSearchResponseSchema = z.object({
  query: z.string().optional(),
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        snippet: z.string().optional(),
        url: z.string().optional()
      })
    )
    .default([])
})

const SearxngConfigResponseSchema = z.object({
  engines: z.array(
    z.object({
      enabled: z.boolean(),
      categories: z.array(z.string()),
      name: z.string()
    })
  )
})

type SearxngSearchContext = UrlSearchContext

export class SearxngProvider extends BaseWebSearchProvider {
  private getBasicAuthHeaders(): Record<string, string> {
    if (!this.provider.basicAuthUsername) {
      return {}
    }

    return {
      Authorization: `Basic ${Buffer.from(
        `${this.provider.basicAuthUsername}:${this.provider.basicAuthPassword}`
      ).toString('base64')}`
    }
  }

  private async resolveEngines(signal?: AbortSignal): Promise<string[]> {
    if (this.provider.engines.length > 0) {
      return this.provider.engines
    }

    const response = await net.fetch(this.resolveApiUrl('/config'), {
      method: 'GET',
      headers: {
        ...defaultAppHeaders(),
        ...this.getBasicAuthHeaders()
      },
      signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Searxng config failed: HTTP ${response.status} ${errorText}`)
    }

    const payload = SearxngConfigResponseSchema.parse(await response.json())

    const engines = payload.engines
      .filter((engine) => engine.enabled && engine.categories.includes('general') && engine.categories.includes('web'))
      .map((engine) => engine.name)

    if (engines.length === 0) {
      throw new Error('No enabled general web search engines found in Searxng configuration')
    }

    return engines
  }

  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const context = await this.prepareSearchContext(query, config, httpOptions)
    const searchPayload = await this.executeSearch(context)
    const fetchedResults = await this.fetchResultContents(context, searchPayload)

    return this.buildFinalResponse(context, searchPayload, fetchedResults)
  }

  private async prepareSearchContext(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<SearxngSearchContext> {
    const signal = httpOptions?.signal ?? undefined
    const engines = await this.resolveEngines(signal)
    const searchParams = new URLSearchParams({
      q: query,
      language: 'auto',
      format: 'json'
    })
    searchParams.set('engines', engines.join(','))

    return {
      query,
      maxResults: config.maxResults,
      searchUrl: `${this.resolveApiUrl('/search')}?${searchParams.toString()}`,
      signal
    }
  }

  private async executeSearch(context: SearxngSearchContext) {
    const response = await net.fetch(context.searchUrl, {
      method: 'GET',
      headers: {
        ...defaultAppHeaders(),
        ...this.getBasicAuthHeaders()
      },
      signal: context.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Searxng search failed: HTTP ${response.status} ${errorText}`)
    }

    return SearxngSearchResponseSchema.parse(await response.json())
  }

  private async fetchResultContents(
    context: SearxngSearchContext,
    searchPayload: z.infer<typeof SearxngSearchResponseSchema>
  ) {
    const validItems = searchPayload.results.filter((item) => isValidUrl(item.url || '')).slice(0, context.maxResults)
    const fetchedResults = await Promise.all(
      validItems.map((item) =>
        fetchWebSearchContent(item.url || '', this.provider.usingBrowser, { signal: context.signal })
      )
    )

    return fetchedResults.filter((item) => item.content !== 'No content found')
  }

  private buildFinalResponse(
    context: SearxngSearchContext,
    searchPayload: z.infer<typeof SearxngSearchResponseSchema>,
    fetchedResults: WebSearchResult[]
  ): WebSearchResponse {
    return {
      query: searchPayload.query || context.query,
      results: fetchedResults
    }
  }
}
