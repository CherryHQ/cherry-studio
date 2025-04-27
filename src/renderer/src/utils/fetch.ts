import { Readability } from '@mozilla/readability'
import { nanoid } from '@reduxjs/toolkit'
import { WebSearchResult } from '@renderer/types'
import TurndownService from 'turndown'

const turndownService = new TurndownService()
export const noContent = 'No content found'

type ResponseFormat = 'markdown' | 'html' | 'text'

/**
 * Validates if the string is a properly formatted URL
 */
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (e) {
    return false
  }
}

export async function fetchWebContents(
  urls: string[],
  format: ResponseFormat = 'markdown',
  usingBrowser: boolean = false
): Promise<WebSearchResult[]> {
  // parallel using fetchWebContent
  const results = await Promise.allSettled(urls.map((url) => fetchWebContent(url, format, usingBrowser)))
  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    } else {
      return {
        title: 'Error',
        content: noContent,
        url: urls[index]
      }
    }
  })
}

export async function fetchWebContent(
  url: string,
  format: ResponseFormat = 'markdown',
  usingBrowser: boolean = false
): Promise<WebSearchResult> {
  try {
    // Validate URL before attempting to fetch
    if (!isValidUrl(url)) {
      throw new Error(`Invalid URL format: ${url}`)
    }

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

    switch (format) {
      case 'markdown': {
        const markdown = turndownService.turndown(article?.content || '')
        return {
          title: article?.title || url,
          url: url,
          content: markdown || noContent
        }
      }
      case 'html':
        return {
          title: article?.title || url,
          url: url,
          content: article?.content || noContent
        }
      case 'text':
        return {
          title: article?.title || url,
          url: url,
          content: article?.textContent || noContent
        }
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
