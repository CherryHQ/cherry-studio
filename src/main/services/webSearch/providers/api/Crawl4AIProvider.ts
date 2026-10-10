import { net } from 'electron'
import * as z from 'zod'

import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

const Crawl4AIMarkdownResponseSchema = z.object({
  url: z.string(),
  markdown: z.string(),
  success: z.boolean()
})

export class Crawl4AIProvider extends BaseWebSearchProvider {
  async fetchUrls(
    query: string,
    _config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const url = query.trim()
    const requestUrl = this.resolveApiUrl('fetchUrls', '/md')
    const apiKey = this.resolveApiKey(false)
    const headers: Record<string, string> = {
      ...defaultAppHeaders(),
      'Content-Type': 'application/json'
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await net.fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, f: 'fit' }),
      signal: httpOptions?.signal ?? undefined
    })

    if (!response.ok) {
      await this.throwHttpError('Crawl4AI fetch failed', response)
    }

    const payload = await this.parseJsonResponse(response, Crawl4AIMarkdownResponseSchema, {
      operation: 'fetch',
      requestUrl
    })
    if (!payload.success) {
      throw new Error(`Crawl4AI fetch failed for ${url}`)
    }
    const content = payload.markdown.trim()
    if (!content) {
      throw new Error(`Crawl4AI fetch returned empty content for ${url}`)
    }

    return {
      query: url,
      providerId: this.provider.id,
      capability: 'fetchUrls',
      inputs: [url],
      results: [{ title: payload.url || url, content, url: payload.url || url, sourceInput: url }]
    }
  }
}
