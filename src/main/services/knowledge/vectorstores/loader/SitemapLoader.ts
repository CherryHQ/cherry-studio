/**
 * Sitemap Loader for KnowledgeServiceV2
 *
 * Handles loading sitemap URLs and converting them to vectorstores nodes.
 * Reuses the embedjs SitemapLoader for content extraction.
 */

import { SitemapLoader as EmbedjsSitemapLoader } from '@cherrystudio/embedjs-loader-sitemap'
import { loggerService } from '@logger'
import { Document, SentenceSplitter } from '@vectorstores/core'
import md5 from 'md5'

import {
  type ContentLoader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type LoaderContext,
  type LoaderResult,
  MB
} from '../types'

const logger = loggerService.withContext('SitemapLoader')

/**
 * Loader for sitemap URLs
 */
export class SitemapLoader implements ContentLoader {
  readonly type = 'sitemap' as const

  /**
   * Load sitemap content and split into chunks
   */
  async load(context: LoaderContext): Promise<LoaderResult> {
    const { base, item, itemId } = context
    const url = item.content as string

    const uniqueId = `SitemapLoader_${md5(url)}`

    logger.debug(`Loading sitemap ${url} for item ${itemId}`)

    if (!url || !this.isValidUrl(url)) {
      logger.warn(`Invalid sitemap URL: ${url}`)
      return {
        nodes: [],
        uniqueId,
        loaderType: 'SitemapLoader'
      }
    }

    const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
    const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

    try {
      // Use embedjs SitemapLoader to fetch and parse the sitemap
      const sitemapLoader = new EmbedjsSitemapLoader({
        url,
        chunkSize,
        chunkOverlap
      })

      // Collect all chunks from the loader
      const documents: Document[] = []
      for await (const chunk of sitemapLoader.getUnfilteredChunks()) {
        documents.push(
          new Document({
            text: chunk.pageContent,
            metadata: {
              ...chunk.metadata,
              source: url,
              type: 'sitemap'
            }
          })
        )
      }

      if (documents.length === 0) {
        logger.warn(`No content extracted from sitemap: ${url}`)
        return {
          nodes: [],
          uniqueId,
          loaderType: 'SitemapLoader'
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

      logger.debug(`Sitemap ${url} loaded with ${nodes.length} chunks`)

      return {
        nodes,
        uniqueId,
        loaderType: 'SitemapLoader'
      }
    } catch (error) {
      logger.error(`Failed to load sitemap ${url}:`, error as Error)
      throw error
    }
  }

  /**
   * Estimate workload for sitemap loading
   * Sitemaps can contain many URLs, use a fixed estimate of 20MB
   */
  estimateWorkload(_context: LoaderContext): number {
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
