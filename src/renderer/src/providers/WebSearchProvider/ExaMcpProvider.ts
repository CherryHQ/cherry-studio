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

  private parsetextChunk(raw: string): ExaSearchResult[] {
    const items: ExaSearchResult[] = []
    for (const chunk of raw.split('\n\n')) {
      // logger.debug('Parsing chunk:', {"chunks": chunk})
      // 3. Parse the labeled lines inside the text block
      const lines = chunk.split('\n')
      // logger.debug('Lines:', lines);
      let title = ''
      let publishedDate = ''
      let url = ''
      let fullText = ''

      // We’ll capture everything after the first "Text:" as the article text
      let textStartIndex = -1

      lines.forEach((line, idx) => {
        if (line.startsWith('Title:')) {
          title = line.replace(/^Title:\s*/, '')
        } else if (line.startsWith('Published Date:')) {
          publishedDate = line.replace(/^Published Date:\s*/, '')
        } else if (line.startsWith('URL:')) {
          url = line.replace(/^URL:\s*/, '')
        } else if (line.startsWith('Text:') && textStartIndex === -1) {
          // mark where "Text:" starts
          textStartIndex = idx
          // text on the same line after "Text: "
          fullText = line.replace(/^Text:\s*/, '')
        }
      })
      if (textStartIndex !== -1) {
        const rest = lines.slice(textStartIndex + 1).join('\n')
        if (rest.trim().length > 0) {
          fullText = (fullText ? fullText + '\n' : '') + rest
        }
      }

      // If we at least got a title or URL, treat it as a valid article
      if (title || url || fullText) {
        items.push({
          title,
          publishedDate,
          url,
          text: fullText
        })
      }
    }
    return items
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
            return { results: this.parsetextChunk(data.result.content[0].text) }
          }
        } catch {
          // Continue to next line if parsing fails
          logger.warn('Failed to parse SSE line:', { line })
        }
      }
    }

    // Try parsing as direct JSON response (non-SSE)
    try {
      const data: McpSearchResponse = JSON.parse(responseText)
      if (data.result?.content?.[0]?.text) {
        return { results: this.parsetextChunk(data.result.content[0].text) }
      }
    } catch {
      // Ignore parsing errors
      logger.warn('Failed to parse direct JSON response:', { responseText })
    }

    return { results: [] }
  }
}
