import { load } from 'cheerio'

import type { SearchItem } from './LocalSearchProvider'
import { LocalSearchProvider } from './LocalSearchProvider'

export class LocalBaiduProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    const $ = load(htmlContent)
    const results: SearchItem[] = []

    $('#content_left .result, #content_left .result-op').each((_, element) => {
      const $element = $(element)
      const $link = $element.find('h3 a').first()
      const title = $link.text().trim()
      const href = $link.attr('href')
      if (!title || !href) {
        return
      }

      results.push({
        title,
        url: this.resolveAbsoluteUrl(href, 'https://www.baidu.com'),
        content: this.extractSnippet(
          $element,
          ['.c-abstract', '.content-right_8Zs40', '.c-span-last', '.c-color-text'],
          title
        )
      })
    })

    return results
  }
}
