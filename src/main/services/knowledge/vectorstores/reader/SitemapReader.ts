/**
 * Sitemap Reader for KnowledgeServiceV2
 *
 * Handles reading sitemap URLs and converting them to vectorstores nodes.
 * Uses sitemapper + fetch + HTMLReader for content extraction.
 */

import { loggerService } from '@logger'
import type { Document } from '@vectorstores/core'
import { SentenceSplitter } from '@vectorstores/core'
import { HTMLReader } from '@vectorstores/readers/html'
import md5 from 'md5'
import Sitemapper from 'sitemapper'

import {
  type ContentReader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  MB,
  type ReaderContext,
  type ReaderResult
} from '../types'

const logger = loggerService.withContext('SitemapReader')

/**
 * Reader for sitemap URLs
 */
export class SitemapReader implements ContentReader {
  readonly type = 'sitemap' as const

  /**
   * Read sitemap content and split into chunks
   */
  async read(context: ReaderContext): Promise<ReaderResult> {
    const { base, item, itemId } = context
    const url = item.content as string

    const uniqueId = `SitemapReader_${md5(url)}`

    logger.debug(`Reading sitemap ${url} for item ${itemId}`)

    if (!url || !this.isValidUrl(url)) {
      logger.warn(`Invalid sitemap URL: ${url}`)
      return {
        nodes: [],
        uniqueId,
        readerType: 'SitemapReader'
      }
    }

    const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
    const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

    try {
      // 1. Parse sitemap and get all URLs
      logger.info(`Fetching sitemap: ${url}`)
      const sitemap = new Sitemapper({ url, timeout: 30000 })
      const { sites } = await sitemap.fetch()

      logger.info(`Sitemap contains ${sites.length} URLs`)

      if (sites.length === 0) {
        logger.warn(`No URLs found in sitemap: ${url}`)
        return {
          nodes: [],
          uniqueId,
          readerType: 'SitemapReader'
        }
      }

      // 2. Fetch and parse each URL
      const documents: Document[] = []
      const reader = new HTMLReader()

      for (const siteUrl of sites) {
        try {
          logger.debug(`Fetching URL from sitemap: ${siteUrl}`)
          const response = await fetch(siteUrl)
          if (!response.ok) {
            logger.warn(`Failed to fetch ${siteUrl}: HTTP ${response.status}`)
            continue
          }
          const html = await response.text()

          const docs = await reader.loadDataAsContent(new TextEncoder().encode(html))
          docs.forEach((doc) => {
            doc.metadata = {
              ...doc.metadata,
              source: siteUrl,
              sitemapUrl: url,
              type: 'sitemap'
            }
          })
          documents.push(...(docs.filter((d) => d.getText().trim().length > 0) as Document[]))
        } catch (err) {
          logger.warn(`Error processing ${siteUrl}:`, err as Error)
        }
      }

      logger.info(`Extracted ${documents.length} documents from sitemap ${url}`)

      if (documents.length === 0) {
        logger.warn(`No content extracted from sitemap: ${url}`)
        return {
          nodes: [],
          uniqueId,
          readerType: 'SitemapReader'
        }
      }

      // Split documents into chunks
      const splitter = new SentenceSplitter({ chunkSize, chunkOverlap })
      const nodes = splitter.getNodesFromDocuments(documents)

      // Add external_id to all nodes
      nodes.forEach((node) => {
        node.metadata = {
          ...node.metadata,
          external_id: itemId
        }
      })

      logger.debug(`Sitemap ${url} read with ${nodes.length} chunks`)

      return {
        nodes,
        uniqueId,
        readerType: 'SitemapReader'
      }
    } catch (error) {
      logger.error(`Failed to read sitemap ${url}:`, error as Error)
      throw error
    }
  }

  /**
   * Estimate workload for sitemap reading
   * Sitemaps can contain many URLs, use a fixed estimate of 20MB
   */
  estimateWorkload(_context: ReaderContext): number {
    return 20 * MB
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }
}
