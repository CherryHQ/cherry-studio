import { loggerService } from '@logger'

const logger = loggerService.withContext('Utils:fetch')

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

/**
 * SWR cache key for an X/Twitter oEmbed fetch. Shared between the citations
 * panel and the citation tooltip so both reuse a single cached oEmbed result.
 */
export const xOembedKey = (url: string) => `xOembed/${url}`

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
