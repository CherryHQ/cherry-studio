import { loggerService } from '@logger'
import type { WebSearchState } from '@renderer/store/websearch'
import type { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('ExaMcpProvider')

interface McpSearchRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      numResults?: number
      livecrawl?: 'fallback' | 'preferred'
      type?: 'auto' | 'fast' | 'deep'
    }
  }
}

interface McpSearchResponse {
  jsonrpc: string
  result: {
    content: Array<{ type: string; text: string }>
  }
}

interface ExaSearchResult {
  title?: string
  url?: string
  text?: string
  publishedDate?: string
  author?: string
}

interface ExaSearchResults {
  results?: ExaSearchResult[]
  autopromptString?: string
}

const DEFAULT_API_HOST = 'https://mcp.exa.ai/mcp'
const DEFAULT_NUM_RESULTS = 8
const REQUEST_TIMEOUT_MS = 25000

export default class ExaMcpProvider extends BaseWebSearchProvider {
  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiHost) {
      this.apiHost = DEFAULT_API_HOST
    }
  }

  public async search(
    query: string,
    websearch: WebSearchState,
    httpOptions?: RequestInit
  ): Promise<WebSearchProviderResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const searchRequest: McpSearchRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'web_search_exa',
          arguments: {
            query,
            type: 'auto',
            numResults: websearch.maxResults || DEFAULT_NUM_RESULTS,
            livecrawl: 'fallback'
          }
        }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(this.apiHost!, {
          method: 'POST',
          headers: {
            ...this.defaultHeaders(),
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json'
          },
          body: JSON.stringify(searchRequest),
          signal: httpOptions?.signal ? AbortSignal.any([controller.signal, httpOptions.signal]) : controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Search error (${response.status}): ${errorText}`)
        }

        const responseText = await response.text()
        const searchResults = this.parseResponse(responseText)

        return {
          query: searchResults.autopromptString || query,
          results: (searchResults.results || []).slice(0, websearch.maxResults).map((result) => ({
            title: result.title || 'No title',
            content: result.text || '',
            url: result.url || ''
          }))
        }
      } catch (error) {
        clearTimeout(timeoutId)

        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Search request timed out')
        }

        throw error
      }
    } catch (error) {
      logger.error('Exa MCP search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private parseResponse(responseText: string): ExaSearchResults {
    // Parse SSE response format
    const lines = responseText.split('\n')
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data: McpSearchResponse = JSON.parse(line.substring(6))
          if (data.result?.content?.[0]?.text) {
            // The text content contains stringified JSON with the actual results
            return JSON.parse(data.result.content[0].text) as ExaSearchResults
          }
        } catch {
          // Continue to next line if parsing fails
        }
      }
    }

    // Try parsing as direct JSON response (non-SSE)
    try {
      const data: McpSearchResponse = JSON.parse(responseText)
      if (data.result?.content?.[0]?.text) {
        return JSON.parse(data.result.content[0].text) as ExaSearchResults
      }
    } catch {
      // Ignore parsing errors
    }

    return { results: [] }
  }
}
