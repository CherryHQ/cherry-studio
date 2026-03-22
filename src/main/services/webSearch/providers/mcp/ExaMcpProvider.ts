import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

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

export class ExaMcpProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const responseText = await this.requestSearch(query, config.maxResults, httpOptions)
    const searchResults = this.parseResponse(responseText)

    return {
      query: searchResults.autopromptString || query,
      results: (searchResults.results || []).slice(0, config.maxResults).map((result) => ({
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
    const lines = responseText.split('\n')

    for (const line of lines) {
      if (!line.startsWith('data: ')) {
        continue
      }

      try {
        const data = McpSearchResponseSchema.parse(JSON.parse(line.substring(6)))
        const text = data.result?.content?.[0]?.text
        if (text) {
          return ExaSearchResultsSchema.parse({ results: this.parseTextChunk(text) })
        }
      } catch {
        continue
      }
    }

    try {
      const data = McpSearchResponseSchema.parse(JSON.parse(responseText))
      const text = data.result?.content?.[0]?.text
      if (text) {
        return ExaSearchResultsSchema.parse({ results: this.parseTextChunk(text) })
      }
    } catch {
      return ExaSearchResultsSchema.parse({ results: [] })
    }

    return ExaSearchResultsSchema.parse({ results: [] })
  }

  private async requestSearch(query: string, numResults: number, httpOptions?: RequestInit): Promise<string> {
    const apiHost = this.provider.apiHost || DEFAULT_API_HOST

    const searchRequest = McpSearchRequestSchema.parse({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query,
          type: 'auto',
          numResults,
          livecrawl: 'fallback'
        }
      }
    })

    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)

    const signal = httpOptions?.signal
      ? AbortSignal.any([timeoutController.signal, httpOptions.signal])
      : timeoutController.signal

    try {
      const response = await net.fetch(apiHost, {
        method: 'POST',
        headers: {
          ...this.defaultHeaders(),
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json'
        },
        body: JSON.stringify(searchRequest),
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
