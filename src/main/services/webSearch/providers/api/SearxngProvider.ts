import { loggerService } from '@logger'
import type { WebSearchExecutionConfig, WebSearchResponse, WebSearchResult } from '@shared/data/types/webSearch'
import { defaultAppHeaders, isValidUrl } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { isAbortError } from '../../utils/errors'
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

const logger = loggerService.withContext('SearxngProvider')

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
      .filter((engine) => engine.enabled && engine.categories.includes('general') && engine.categories.includes('web'))
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
    const context = await this.prepareSearchContext(query, config, httpOptions)
    const searchPayload = await this.executeSearch(context)
    const fetchedResults = await this.fetchResultContents(context, searchPayload)

    return this.buildFinalResponse(context, fetchedResults)
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
      searchUrl: `${this.resolveApiUrl('searchKeywords', '/search')}?${searchParams.toString()}`,
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
      await this.throwHttpError('Searxng search failed', response)
    }

    return this.parseJsonResponse(response, SearxngSearchResponseSchema, {
      operation: 'search',
      requestUrl: context.searchUrl
    })
  }

  private async fetchResultContents(
    context: SearxngSearchContext,
    searchPayload: z.infer<typeof SearxngSearchResponseSchema>
  ) {
    const validItems = searchPayload.results.filter((item) => isValidUrl(item.url || '')).slice(0, context.maxResults)
    const settledResults = await Promise.allSettled(
      validItems.map((item) => fetchWebSearchContent(item.url || '', { signal: context.signal }))
    )

    const rejectedResults = settledResults.filter((item): item is PromiseRejectedResult => item.status === 'rejected')

    const abortResult = rejectedResults.find((item) => isAbortError(item.reason))

    if (abortResult) {
      throw abortResult.reason
    }

    if (rejectedResults.length > 0) {
      logger.warn('Some Searxng content fetches failed', {
        query: context.query,
        failedCount: rejectedResults.length,
        totalCount: validItems.length
      })
    }

    const fulfilledResults = settledResults.filter(
      (item): item is PromiseFulfilledResult<WebSearchResult> => item.status === 'fulfilled'
    )

    if (fulfilledResults.length === 0 && rejectedResults.length > 0) {
      throw rejectedResults[0].reason
    }

    return fulfilledResults.map((item) => item.value).filter((item) => item.content.trim().length > 0)
  }

  private buildFinalResponse(context: SearxngSearchContext, fetchedResults: WebSearchResult[]): WebSearchResponse {
    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: fetchedResults.map((result) => ({
        ...result,
        sourceInput: context.query
      }))
    }
  }
}
