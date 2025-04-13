import { Readability } from '@mozilla/readability'
import { nanoid } from '@reduxjs/toolkit'
import { WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchResponse, WebSearchResult } from '@renderer/types'
import TurndownService from 'turndown'

import BaseWebSearchProvider from './BaseWebSearchProvider'

export interface SearchItem {
  title: string
  url: string
}

const noContent = 'No content found'

export default class LocalSearchProvider extends BaseWebSearchProvider {
  private turndownService: TurndownService = new TurndownService()

  constructor(provider: WebSearchProvider) {
    if (!provider || !provider.url) {
      throw new Error('Provider URL is required')
    }
    super(provider)
  }

  public async search(query: string, websearch: WebSearchState): Promise<WebSearchResponse> {
    const uid = nanoid()
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }
      if (!this.provider.url) {
        throw new Error('Provider URL is required')
      }

      const cleanedQuery = query.split('\r\n')[1] ?? query
      const url = this.provider.url.replace('%s', encodeURIComponent(cleanedQuery))
      const content = await window.api.searchService.openUrlInSearchWindow(uid, url)

      // Parse the content to extract URLs and metadata
      const searchItems = this.parseValidUrls(content).slice(0, websearch.maxResults)

      const validItems = searchItems
        .filter((item) => item.url.startsWith('http') || item.url.startsWith('https'))
        .slice(0, websearch.maxResults)
      // console.log('Valid search items:', validItems)

      // Fetch content for each URL concurrently
      const fetchPromises = validItems.map(async (item) => {
        // console.log(`Fetching content for ${item.url}...`)
        const result = await this.fetchPageContent(item.url, this.provider.usingBrowser)
        if (
          this.provider.contentLimit &&
          this.provider.contentLimit != -1 &&
          result.content.length > this.provider.contentLimit
        ) {
          result.content = result.content.slice(0, this.provider.contentLimit) + '...'
        }
        return result
      })

      // Wait for all fetches to complete
      const results: WebSearchResult[] = await Promise.all(fetchPromises)

      return {
        query: query,
        results: results.filter((result) => result.content != noContent)
      }
    } catch (error) {
      console.error('Local search failed:', error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      await window.api.searchService.closeSearchWindow(uid)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected parseValidUrls(_htmlContent: string): SearchItem[] {
    throw new Error('Not implemented')
  }

  private async fetchPageContent(url: string, usingBrowser: boolean = false): Promise<WebSearchResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      let html: string
      if (usingBrowser) {
        html = await window.api.searchService.openUrlInSearchWindow(`search-window-${nanoid()}`, url)
      } else {
        const response = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: controller.signal
        })
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`)
        }
        html = await response.text()
      }

      clearTimeout(timeoutId) // Clear the timeout if fetch completes successfully
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      const article = new Readability(doc).parse()
      // console.log('Parsed article:', article)
      const markdown = this.turndownService.turndown(article?.content || '')
      return {
        title: article?.title || url,
        url: url,
        content: markdown || noContent
      }
    } catch (e: unknown) {
      console.error(`Failed to fetch ${url}`, e)
      return {
        title: url,
        url: url,
        content: noContent
      }
    }
  }
}
