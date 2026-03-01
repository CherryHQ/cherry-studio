/**
 * Sitemap Reader for KnowledgeServiceV2
 *
 * Handles reading sitemap URLs and converting them to vectorstores nodes.
 * Uses sitemapper + fetch + HTMLReader for content extraction.
 */

import { loggerService } from '@logger'
import type { SitemapItemData } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'
import { HTMLReader } from '@vectorstores/readers/html'
import Sitemapper from 'sitemapper'

import { TextChunkSplitter } from '../splitters/TextChunkSplitter'
import {
  type ContentReader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type ReaderContext,
  type ReaderResult
} from '../types'
import { applyNodeMetadata } from './utils'

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
    const { base, item } = context
    const sitemapData = item.data as SitemapItemData
    const url = sitemapData.url

    logger.debug(`Reading sitemap ${url} for item ${item.id}`)

    if (!url || !this.isValidUrl(url)) {
      logger.warn(`Invalid sitemap URL: ${url}`)
      return { nodes: [] }
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
        return { nodes: [] }
      }

      // 2. Fetch and parse URLs concurrently in batches
      const documents: Document[] = []
      const reader = new HTMLReader()
      const CONCURRENCY = 5

      for (let i = 0; i < sites.length; i += CONCURRENCY) {
        const batch = sites.slice(i, i + CONCURRENCY)
        const results = await Promise.allSettled(
          batch.map(async (siteUrl) => {
            logger.debug(`Fetching URL from sitemap: ${siteUrl}`)
            const response = await fetch(siteUrl)
            if (!response.ok) {
              logger.warn(`Failed to fetch ${siteUrl}: HTTP ${response.status}`)
              return []
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
            return docs.filter((d) => d.getText().trim().length > 0) as Document[]
          })
        )
        for (const result of results) {
          if (result.status === 'fulfilled') {
            documents.push(...result.value)
          } else {
            logger.warn('Error processing sitemap URL:', result.reason)
          }
        }
      }

      logger.info(`Extracted ${documents.length} documents from sitemap ${url}`)

      if (documents.length === 0) {
        logger.warn(`No content extracted from sitemap: ${url}`)
        return { nodes: [] }
      }

      // Split documents into chunks
      const nodes = TextChunkSplitter(documents, { chunkSize, chunkOverlap })

      applyNodeMetadata(nodes, { externalId: item.id })

      logger.debug(`Sitemap ${url} read with ${nodes.length} chunks`)

      return { nodes }
    } catch (error) {
      logger.error(`Failed to read sitemap ${url}:`, error as Error)
      throw error
    }
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
