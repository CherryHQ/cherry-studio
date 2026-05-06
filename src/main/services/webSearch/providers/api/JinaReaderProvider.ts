import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { defaultAppHeaders, isValidUrl, withoutTrailingSlash } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { resolveProviderApiHost, resolveProviderApiKey } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { BaseSearchContext } from '../base/context'

const JinaReaderResponseSchema = z.looseObject({
  code: z.union([z.number(), z.string()]).optional(),
  status: z.union([z.number(), z.string()]).optional(),
  data: z
    .looseObject({
      title: z.string().optional(),
      content: z.string().optional(),
      text: z.string().optional(),
      url: z.string().optional()
    })
    .optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional()
})

type JinaReaderContext = BaseSearchContext & {
  apiKey: string
  requestUrl: string
}

export class JinaReaderProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const context = this.prepareSearchContext(query, config, httpOptions)
    const payload = await this.executeSearch(context)

    return this.buildFinalResponse(context, payload)
  }

  private prepareSearchContext(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): JinaReaderContext {
    const url = query.trim()

    if (!isValidUrl(url)) {
      throw new Error(`Invalid URL format: ${url}`)
    }

    return {
      apiKey: resolveProviderApiKey(this.provider),
      query: url,
      maxResults: config.maxResults,
      requestUrl: `${withoutTrailingSlash(resolveProviderApiHost(this.provider))}/${url}`,
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: JinaReaderContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'GET',
      headers: {
        ...defaultAppHeaders(),
        Accept: 'application/json',
        Authorization: `Bearer ${context.apiKey}`,
        'X-Retain-Images': 'none'
      },
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('Jina Reader fetch failed', response)
    }

    return this.parseJsonResponse(response, JinaReaderResponseSchema, {
      operation: 'reader',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    context: JinaReaderContext,
    payload: z.infer<typeof JinaReaderResponseSchema>
  ): WebSearchResponse {
    const data = payload.data || payload
    const content = data.content?.trim() || data.text?.trim() || ''

    return {
      query: context.query,
      results: [
        {
          title: data.title?.trim() || context.query,
          content,
          url: data.url || context.query
        }
      ].slice(0, context.maxResults)
    }
  }
}
