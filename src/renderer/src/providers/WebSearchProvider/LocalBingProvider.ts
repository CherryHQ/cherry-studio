import { loggerService } from '@logger'

import LocalSearchProvider, { SearchItem } from './LocalSearchProvider'

const logger = loggerService.withContext('LocalBingProvider')

export default class LocalBingProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    const results: SearchItem[] = []

    try {
      // Parse HTML string into a DOM document
      const parser = new DOMParser()
      const doc = parser.parseFromString(htmlContent, 'text/html')

      const items = doc.querySelectorAll('#b_results h2')
      items.forEach((item) => {
        const node = item.querySelector('a')
        if (node) {
          const decodedUrl = this.decodeBingUrl(node.href)
          results.push({
            title: node.textContent || '',
            url: decodedUrl
          })
        }
      })
    } catch (error) {
      logger.error('Failed to parse Bing search HTML:', error as Error)
    }
    return results
  }

  /**
   * Decode Bing redirect URL to get the actual URL
   * Bing URLs are in format: https://www.bing.com/ck/a?...&u=a1aHR0cHM6Ly93d3cudG91dGlhby5jb20...
   * The 'u' parameter contains Base64 encoded URL with 'a1' prefix
   */
  private decodeBingUrl(bingUrl: string): string {
    try {
      const url = new URL(bingUrl)
      const encodedUrl = url.searchParams.get('u')

      if (!encodedUrl) {
        return bingUrl // Return original if no 'u' parameter
      }

      // Remove the 'a1' prefix and decode Base64
      const base64Part = encodedUrl.substring(2)
      const decodedUrl = atob(base64Part)

      // Validate the decoded URL
      if (decodedUrl.startsWith('http')) {
        return decodedUrl
      }

      return bingUrl // Return original if decoded URL is invalid
    } catch (error) {
      logger.warn('Failed to decode Bing URL:', error as Error)
      return bingUrl // Return original URL if decoding fails
    }
  }
}
