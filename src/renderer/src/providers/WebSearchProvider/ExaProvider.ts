import { loggerService } from '@logger'
import { WebSearchState } from '@renderer/store/websearch'
import {
  ExaSearchResult as ExaSearchResultType,
  ProviderSpecificParams,
  WebSearchProvider,
  WebSearchProviderResponse
} from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('ExaProvider')

interface ExaSearchRequest {
  query: string
  numResults: number
  contents?: {
    text?: boolean
    highlights?: boolean
    summary?: boolean
  }
  useAutoprompt?: boolean
  category?: string
  type?: 'keyword' | 'neural' | 'auto' | 'fast'
  startPublishedDate?: string
  endPublishedDate?: string
  startCrawlDate?: string
  endCrawlDate?: string
  includeDomains?: string[]
  excludeDomains?: string[]
}

interface ExaSearchResult {
  title: string | null
  url: string | null
  text?: string | null
  author?: string | null
  score?: number
  publishedDate?: string | null
  favicon?: string | null
  highlights?: string[]
}

interface ExaSearchResponse {
  autopromptString?: string
  results: ExaSearchResult[]
  resolvedSearchType?: string
}

export default class ExaProvider extends BaseWebSearchProvider {
  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiKey) {
      throw new Error('API key is required for Exa provider')
    }
    if (!this.apiHost) {
      throw new Error('API host is required for Exa provider')
    }
  }

  /**
   * 统一的搜索方法 - 根据 providerParams 决定是否使用高级参数
   */
  public async search(
    query: string,
    websearch: WebSearchState,
    httpOptions?: RequestInit,
    providerParams?: ProviderSpecificParams
  ): Promise<WebSearchProviderResponse> {
    // 如果提供了 Exa 特定参数，使用高级搜索
    if (providerParams?.exa) {
      return this.searchWithParams({
        query,
        numResults: websearch.maxResults,
        ...providerParams.exa, // 展开高级参数
        signal: httpOptions?.signal ?? undefined
      })
    }

    // 否则使用默认参数
    return this.searchWithParams({
      query,
      numResults: websearch.maxResults,
      useAutoprompt: true,
      signal: httpOptions?.signal ?? undefined
    })
  }

  /**
   * 使用完整参数进行搜索（支持 Exa 的所有高级功能）
   */
  public async searchWithParams(params: {
    query: string
    numResults?: number
    type?: 'keyword' | 'neural' | 'auto' | 'fast'
    category?: string
    startPublishedDate?: string
    endPublishedDate?: string
    startCrawlDate?: string
    endCrawlDate?: string
    useAutoprompt?: boolean
    includeDomains?: string[]
    excludeDomains?: string[]
    signal?: AbortSignal
  }): Promise<WebSearchProviderResponse> {
    try {
      if (!params.query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const requestBody: ExaSearchRequest = {
        query: params.query,
        numResults: Math.max(1, params.numResults || 5),
        contents: {
          text: true,
          highlights: true // 获取高亮片段
        },
        useAutoprompt: params.useAutoprompt ?? true
      }

      // 添加可选参数
      if (params.type) {
        requestBody.type = params.type
      }

      if (params.category) {
        requestBody.category = params.category
      }

      if (params.startPublishedDate) {
        requestBody.startPublishedDate = params.startPublishedDate
      }

      if (params.endPublishedDate) {
        requestBody.endPublishedDate = params.endPublishedDate
      }

      if (params.startCrawlDate) {
        requestBody.startCrawlDate = params.startCrawlDate
      }

      if (params.endCrawlDate) {
        requestBody.endCrawlDate = params.endCrawlDate
      }

      if (params.includeDomains && params.includeDomains.length > 0) {
        requestBody.includeDomains = params.includeDomains
      }

      if (params.excludeDomains && params.excludeDomains.length > 0) {
        requestBody.excludeDomains = params.excludeDomains
      }

      const response = await fetch(`${this.apiHost}/search`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey!,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: params.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Exa API error (${response.status}): ${errorText}`)
      }

      const data: ExaSearchResponse = await response.json()

      // 返回完整的 Exa 结果（包含 favicon、author、score 等字段）
      return {
        query: data.autopromptString || params.query,
        results: data.results.slice(0, params.numResults || 5).map(
          (result): ExaSearchResultType => ({
            title: result.title || 'No title',
            content: result.text || '',
            url: result.url || '',
            favicon: result.favicon || undefined,
            publishedDate: result.publishedDate || undefined,
            author: result.author || undefined,
            score: result.score,
            highlights: result.highlights
          })
        )
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }
      logger.error('Exa search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
