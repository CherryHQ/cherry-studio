import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'
import { net } from 'electron'
import { XMLParser } from 'fast-xml-parser'

import type { KnowledgeReader } from './KnowledgeReader'
import { KnowledgeUrlReader } from './KnowledgeUrlReader'

export class KnowledgeSitemapReader implements KnowledgeReader<KnowledgeItemOf<'sitemap'>> {
  private readonly parser = new XMLParser()
  private readonly urlReader = new KnowledgeUrlReader()

  async load(item: KnowledgeItemOf<'sitemap'>): Promise<Document[]> {
    const urls = await this.collectUrls(item.data.url)
    const uniqueUrls = Array.from(new Set(urls))
    const documents = await Promise.all(
      uniqueUrls.map(async (url) => {
        const urlItem: KnowledgeItemOf<'url'> = {
          ...item,
          type: 'url',
          data: {
            url,
            name: url
          }
        }

        return await this.urlReader.load(urlItem)
      })
    )

    return documents.flat()
  }

  private async collectUrls(sitemapUrl: string, depth = 0): Promise<string[]> {
    if (depth > 3) {
      throw new Error(`Sitemap nesting is too deep: ${sitemapUrl}`)
    }

    const response = await net.fetch(sitemapUrl)
    if (!response.ok) {
      throw new Error(`Failed to read sitemap ${sitemapUrl}: HTTP ${response.status}`)
    }

    const xml = await response.text()
    const parsed = this.parser.parse(xml) as {
      urlset?: { url?: Array<{ loc?: string }> | { loc?: string } }
      sitemapindex?: { sitemap?: Array<{ loc?: string }> | { loc?: string } }
    }

    const pageUrls = this.normalizeLocs(parsed.urlset?.url)
    if (pageUrls.length > 0) {
      return pageUrls
    }

    const nestedSitemapUrls = this.normalizeLocs(parsed.sitemapindex?.sitemap)
    if (nestedSitemapUrls.length > 0) {
      const nestedUrls = await Promise.all(nestedSitemapUrls.map((url) => this.collectUrls(url, depth + 1)))
      return nestedUrls.flat()
    }

    return []
  }

  private normalizeLocs(value: Array<{ loc?: string }> | { loc?: string } | undefined): string[] {
    if (!value) {
      return []
    }

    const entries = Array.isArray(value) ? value : [value]
    return entries.map((entry) => entry.loc?.trim()).filter((loc): loc is string => Boolean(loc))
  }
}
