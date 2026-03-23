import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { defaultAppHeaders } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { RequestSearchContext } from '../base/context'

const McpSearchRequestSchema = z.object({
  jsonrpc: z.string(),
  id: z.number().int(),
  method: z.string(),
  params: z.object({
    name: z.string(),
    arguments: z.object({
      query: z.string(),
      numResults: z.number().int().positive().optional(),
      livecrawl: z.enum(['fallback', 'preferred']).optional(),
      type: z.enum(['auto', 'fast', 'deep']).optional()
    })
  })
})

const McpSearchResponseSchema = z.object({
  result: z.object({
    content: z.array(
      z.object({
        type: z.string(),
        text: z.string()
      })
    )
  })
})

const ExaSearchResultSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  text: z.string().optional()
})

const ExaSearchResultsSchema = z.object({
  results: z.array(ExaSearchResultSchema).default([]),
  autopromptString: z.string().optional()
})

const DEFAULT_API_HOST = 'https://mcp.exa.ai/mcp'
const REQUEST_TIMEOUT_MS = 25000

type ExaMcpSearchContext = RequestSearchContext<z.infer<typeof McpSearchRequestSchema>> & {
  upstreamSignal?: AbortSignal
}

export class ExaMcpProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const context = this.prepareSearchContext(query, config, httpOptions)
    const responseText = await this.executeSearch(context)

    return this.buildFinalResponse(context, responseText)
  }

  private prepareSearchContext(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): ExaMcpSearchContext {
    return {
      query,
      maxResults: config.maxResults,
      requestUrl: this.provider.apiHost || DEFAULT_API_HOST,
      requestBody: McpSearchRequestSchema.parse({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'web_search_exa',
          arguments: {
            query,
            type: 'auto',
            numResults: config.maxResults,
            livecrawl: 'fallback'
          }
        }
      }),
      upstreamSignal: httpOptions?.signal ?? undefined
    }
  }

  private buildFinalResponse(context: ExaMcpSearchContext, responseText: string): WebSearchResponse {
    const searchResults = this.parseResponse(responseText)

    return {
      query: searchResults.autopromptString || context.query,
      results: (searchResults.results || []).slice(0, context.maxResults).map((result) => ({
        title: result.title || 'No title',
        content: result.text || '',
        url: result.url || ''
      }))
    }
  }

  private parseTextChunk(raw: string) {
    const items: z.input<typeof ExaSearchResultSchema>[] = []

    for (const chunk of raw.split('\n\n')) {
      const lines = chunk.split('\n')
      let title = ''
      let url = ''
      let fullText = ''
      let textStartIndex = -1

      lines.forEach((line, index) => {
        if (line.startsWith('Title:')) {
          title = line.replace(/^Title:\s*/, '')
        } else if (line.startsWith('URL:')) {
          url = line.replace(/^URL:\s*/, '')
        } else if (line.startsWith('Text:') && textStartIndex === -1) {
          textStartIndex = index
          fullText = line.replace(/^Text:\s*/, '')
        }
      })

      if (textStartIndex !== -1) {
        const rest = lines.slice(textStartIndex + 1).join('\n')
        if (rest.trim().length > 0) {
          fullText = fullText ? `${fullText}\n${rest}` : rest
        }
      }

      if (title || url || fullText) {
        items.push({
          title,
          url,
          text: fullText
        })
      }
    }

    return z.array(ExaSearchResultSchema).parse(items)
  }

  private parseResponse(responseText: string) {
    const payloadTexts: string[] = []

    for (const match of responseText.matchAll(/^data:\s*(.+)$/gm)) {
      const text = this.extractContentText(match[1])
      if (text) {
        payloadTexts.push(text)
      }
    }

    if (payloadTexts.length === 0) {
      const directText = this.extractContentText(responseText)
      if (directText) {
        payloadTexts.push(directText)
      }
    }

    if (payloadTexts.length === 0 && responseText.includes('Title:')) {
      payloadTexts.push(responseText)
    }

    return ExaSearchResultsSchema.parse({
      results: this.parseTextChunk(payloadTexts.join('\n\n')).filter((item) =>
        Boolean(item.title || item.url || item.text)
      )
    })
  }

  private extractContentText(payload: string): string | null {
    const parsedPayload = McpSearchResponseSchema.safeParse(JSON.parse(payload))
    if (!parsedPayload.success) {
      return null
    }

    const text = parsedPayload.data.result.content
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n\n')

    return text || null
  }

  private async executeSearch(context: ExaMcpSearchContext): Promise<string> {
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)

    const signal = context.upstreamSignal
      ? AbortSignal.any([timeoutController.signal, context.upstreamSignal])
      : timeoutController.signal

    try {
      const response = await net.fetch(context.requestUrl, {
        method: 'POST',
        headers: {
          ...defaultAppHeaders(),
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json'
        },
        body: JSON.stringify(context.requestBody),
        signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Exa MCP search failed: ${response.status} ${errorText}`)
      }

      return await response.text()
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
