import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

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
  result: {
    content: Array<{ type: string; text: string }>
  }
}

interface ExaSearchResult {
  title?: string
  url?: string
  text?: string
}

interface ExaSearchResults {
  results?: ExaSearchResult[]
  autopromptString?: string
}

const DEFAULT_API_HOST = 'https://mcp.exa.ai/mcp'
const REQUEST_TIMEOUT_MS = 25000

export class ExaMcpProvider extends BaseWebSearchProvider {
  async check(httpOptions?: RequestInit): Promise<void> {
    const responseText = await this.requestSearch(this.getCheckQuery(), 1, httpOptions)

    if (!responseText.trim()) {
      throw new Error('Exa MCP check failed: empty response body')
    }

    const searchResults = this.parseResponse(responseText)
    if (!searchResults.results || searchResults.results.length === 0) {
      throw new Error('Exa MCP check failed: no parseable search results returned')
    }
  }

  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    this.assertNonEmptyQuery(query)

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

  private parseTextChunk(raw: string): ExaSearchResult[] {
    const items: ExaSearchResult[] = []

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

    return items
  }

  private parseResponse(responseText: string): ExaSearchResults {
    const lines = responseText.split('\n')

    for (const line of lines) {
      if (!line.startsWith('data: ')) {
        continue
      }

      try {
        const data: McpSearchResponse = JSON.parse(line.substring(6))
        const text = data.result?.content?.[0]?.text
        if (text) {
          return { results: this.parseTextChunk(text) }
        }
      } catch {
        continue
      }
    }

    try {
      const data: McpSearchResponse = JSON.parse(responseText)
      const text = data.result?.content?.[0]?.text
      if (text) {
        return { results: this.parseTextChunk(text) }
      }
    } catch {
      return { results: [] }
    }

    return { results: [] }
  }

  private async requestSearch(query: string, numResults: number, httpOptions?: RequestInit): Promise<string> {
    const apiHost = this.provider.apiHost || DEFAULT_API_HOST

    const searchRequest: McpSearchRequest = {
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
    }

    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)

    const signal = httpOptions?.signal
      ? AbortSignal.any([timeoutController.signal, httpOptions.signal])
      : timeoutController.signal

    try {
      const response = await this.netFetch(apiHost, {
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
