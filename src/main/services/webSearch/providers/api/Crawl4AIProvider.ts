import { net } from 'electron'
import * as z from 'zod'

import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

/** Self-hosted server (`crawl4ai` Docker image): `POST /md`. */
const Crawl4AIMarkdownResponseSchema = z.object({
  url: z.string(),
  markdown: z.string(),
  success: z.boolean()
})

/** Hosted Crawl4AI Cloud (`api.crawl4ai.com`): `POST /scrape`. */
const Crawl4AICloudScrapeResponseSchema = z.object({
  ok: z.boolean(),
  markdown: z.string().optional()
})

const CRAWL4AI_CLOUD_HOST = 'crawl4ai.com'

function isCrawl4AICloudUrl(requestUrl: string): boolean {
  const { hostname } = new URL(requestUrl)
  return hostname === CRAWL4AI_CLOUD_HOST || hostname.endsWith(`.${CRAWL4AI_CLOUD_HOST}`)
}

export class Crawl4AIProvider extends BaseWebSearchProvider {
  async fetchUrls(
    query: string,
    _config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const url = query.trim()
    const signal = httpOptions?.signal ?? undefined
    const content = isCrawl4AICloudUrl(this.resolveApiUrl('fetchUrls', '/'))
      ? await this.fetchFromCloud(url, signal)
      : await this.fetchFromSelfHosted(url, signal)

    return {
      query: url,
      providerId: this.provider.id,
      capability: 'fetchUrls',
      inputs: [url],
      results: [{ title: content.url, content: content.markdown, url: content.url, sourceInput: url }]
    }
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...defaultAppHeaders(),
      'Content-Type': 'application/json'
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    return headers
  }

  private async fetchFromSelfHosted(url: string, signal: AbortSignal | undefined) {
    const requestUrl = this.resolveApiUrl('fetchUrls', '/md')
    const response = await net.fetch(requestUrl, {
      method: 'POST',
      headers: this.buildHeaders(this.resolveApiKey(false)),
      body: JSON.stringify({ url, f: 'fit' }),
      signal
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
    return { url: payload.url || url, markdown: this.requireContent(payload.markdown, url) }
  }

  private async fetchFromCloud(url: string, signal: AbortSignal | undefined) {
    const requestUrl = this.resolveApiUrl('fetchUrls', '/scrape')
    const response = await net.fetch(requestUrl, {
      method: 'POST',
      // The hosted API authenticates every request.
      headers: this.buildHeaders(this.resolveApiKey()),
      body: JSON.stringify({ url, format: 'md' }),
      signal
    })

    if (!response.ok) {
      await this.throwHttpError('Crawl4AI fetch failed', response)
    }

    const payload = await this.parseJsonResponse(response, Crawl4AICloudScrapeResponseSchema, {
      operation: 'fetch',
      requestUrl
    })
    if (!payload.ok) {
      throw new Error(`Crawl4AI fetch failed for ${url}`)
    }
    return { url, markdown: this.requireContent(payload.markdown ?? '', url) }
  }

  private requireContent(markdown: string, url: string): string {
    const content = markdown.trim()
    if (!content) {
      throw new Error(`Crawl4AI fetch returned empty content for ${url}`)
    }
    return content
  }
}
