import { loggerService } from '@logger'
import { WebSearchState } from '@renderer/store/websearch'
import {
  ProviderSpecificParams,
  TavilySearchResult as TavilySearchResultType,
  WebSearchProvider,
  WebSearchProviderResponse
} from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('TavilyProvider')

interface TavilySearchRequest {
  query: string
  max_results?: number
  topic?: 'general' | 'news' | 'finance'
  search_depth?: 'basic' | 'advanced'
  include_answer?: boolean
  include_raw_content?: boolean
  include_images?: boolean
  include_domains?: string[]
  exclude_domains?: string[]
}

interface TavilySearchResult {
  title: string
  url: string
  content: string
  raw_content?: string
  score?: number
}

interface TavilySearchResponse {
  query: string
  results: TavilySearchResult[]
  answer?: string
  images?: string[]
  response_time?: number
}

export default class TavilyProvider extends BaseWebSearchProvider {
  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiKey) {
      throw new Error('API key is required for Tavily provider')
    }
    if (!this.apiHost) {
      throw new Error('API host is required for Tavily provider')
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
    // 如果提供了 Tavily 特定参数，使用高级搜索
    if (providerParams?.tavily) {
      return this.searchWithParams({
        query,
        maxResults: websearch.maxResults,
        ...providerParams.tavily, // 展开高级参数
        signal: httpOptions?.signal ?? undefined
      })
    }

    // 否则使用默认参数
    return this.searchWithParams({
      query,
      maxResults: websearch.maxResults,
      includeRawContent: true,
      signal: httpOptions?.signal ?? undefined
    })
  }

  /**
   * 使用完整参数进行搜索（支持 Tavily 的所有高级功能）
   */
  public async searchWithParams(params: {
    query: string
    maxResults?: number
    topic?: 'general' | 'news' | 'finance'
    searchDepth?: 'basic' | 'advanced'
    includeAnswer?: boolean
    includeRawContent?: boolean
    includeImages?: boolean
    includeDomains?: string[]
    excludeDomains?: string[]
    signal?: AbortSignal
  }): Promise<WebSearchProviderResponse> {
    try {
      if (!params.query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const requestBody: TavilySearchRequest = {
        query: params.query,
        max_results: Math.max(1, params.maxResults || 5),
        include_raw_content: params.includeRawContent ?? true,
        include_answer: params.includeAnswer ?? true,
        include_images: params.includeImages ?? false
      }

      // 添加可选参数
      if (params.topic) {
        requestBody.topic = params.topic
      }

      if (params.searchDepth) {
        requestBody.search_depth = params.searchDepth
      }

      if (params.includeDomains && params.includeDomains.length > 0) {
        requestBody.include_domains = params.includeDomains
      }

      if (params.excludeDomains && params.excludeDomains.length > 0) {
        requestBody.exclude_domains = params.excludeDomains
      }

      const response = await fetch(`${this.apiHost}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...requestBody,
          api_key: this.apiKey
        }),
        signal: params.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Tavily API error (${response.status}): ${errorText}`)
      }

      const data: TavilySearchResponse = await response.json()

      // 返回完整的 Tavily 结果（包含 answer、images 等字段）
      return {
        query: data.query,
        results: data.results.slice(0, params.maxResults || 5).map(
          (item): TavilySearchResultType => ({
            title: item.title || 'No title',
            content: item.raw_content || item.content || '',
            url: item.url || '',
            rawContent: item.raw_content,
            score: item.score,
            answer: data.answer, // Tavily 的直接答案
            images: data.images  // Tavily 的图片
          })
        )
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }
      logger.error('Tavily search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
