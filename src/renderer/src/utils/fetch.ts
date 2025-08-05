import { loggerService } from '@logger'
import { Readability } from '@mozilla/readability'
import { nanoid } from '@reduxjs/toolkit'
import { WebSearchProviderResult } from '@renderer/types'
import { createAbortPromise } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import TurndownService from 'turndown'

const logger = loggerService.withContext('Utils:fetch')

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
  usingBrowser: boolean = false,
  httpOptions: RequestInit = {}
): Promise<WebSearchProviderResult[]> {
  // parallel using fetchWebContent
  const results = await Promise.allSettled(urls.map((url) => fetchWebContent(url, format, usingBrowser, httpOptions)))
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
  usingBrowser: boolean = false,
  httpOptions: RequestInit = {}
): Promise<WebSearchProviderResult> {
  try {
    // Validate URL before attempting to fetch
    if (!isValidUrl(url)) {
      throw new Error(`Invalid URL format: ${url}`)
    }

    let html: string
    if (usingBrowser) {
      const windowApiPromise = window.api.searchService.openUrlInSearchWindow(`search-window-${nanoid()}`, url)

      const promisesToRace: [Promise<string>] = [windowApiPromise]

      if (httpOptions?.signal) {
        const signal = httpOptions.signal
        const abortPromise = createAbortPromise(signal, windowApiPromise)
        promisesToRace.push(abortPromise)
      }

      html = await Promise.race(promisesToRace)
    } else {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        ...httpOptions,
        signal: httpOptions?.signal
          ? AbortSignal.any([httpOptions.signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000)
      })
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }
      html = await response.text()
    }

    // clearTimeout(timeoutId) // Clear the timeout if fetch completes successfully
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const article = new Readability(doc).parse()
    // Logger.log('Parsed article:', article)

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
    if (isAbortError(e)) {
      throw e
    }

    logger.error(`Failed to fetch ${url}`, e as Error)
    return {
      title: url,
      url: url,
      content: noContent
    }
  }
}

export async function fetchRedirectUrl(url: string) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
    return response.url
  } catch (e) {
    logger.error('Failed to fetch redirect url', e as Error)
    return url
  }
}
