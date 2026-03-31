import { loggerService } from '@logger'
import { Readability } from '@mozilla/readability'
import { nanoid } from '@reduxjs/toolkit'
import type { WebSearchProviderResult } from '@renderer/types'
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
export function isValidUrl(urlString: string): boolean {
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

/**
 * Check if a URL is an X/Twitter post URL
 */
export function isXPostUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    return (host === 'x.com' || host === 'twitter.com') && /\/status\/\d+/.test(parsed.pathname)
  } catch {
    return false
  }
}

/**
 * Fetch tweet content via X oEmbed API
 * @see https://docs.x.com/x-for-websites/oembed-api
 */
export async function fetchXOEmbed(url: string): Promise<{ author: string; text: string } | null> {
  try {
    const oembedUrl = `https://publish.x.com/oembed?url=${encodeURIComponent(url)}&omit_script=1&dnt=1`
    const response = await fetch(oembedUrl, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) return null
    const data = await response.json()
    // Extract text from html: <blockquote ...><p ...>text</p>&mdash; author ...</blockquote>
    const parser = new DOMParser()
    const doc = parser.parseFromString(data.html || '', 'text/html')
    const paragraphs = doc.querySelectorAll('blockquote p')
    const text = Array.from(paragraphs)
      .map((p) => p.textContent)
      .join('\n')
    return {
      author: data.author_name || '',
      text: text || ''
    }
  } catch (e) {
    logger.warn('Failed to fetch X oEmbed', e as Error)
    return null
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
