/**
 * URL Loader for KnowledgeServiceV2
 *
 * Handles loading web URLs and converting them to vectorstores nodes.
 * Reuses the embedjs WebLoader for content extraction.
 */

import { WebLoader as EmbedjsWebLoader } from '@cherrystudio/embedjs-loader-web'
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

const logger = loggerService.withContext('UrlLoader')

/**
 * Loader for web URLs
 */
export class UrlLoader implements ContentLoader {
  readonly type = 'url' as const

  /**
   * Load URL content and split into chunks
   */
  async load(context: LoaderContext): Promise<LoaderResult> {
    const { base, item, itemId } = context
    const url = item.content as string

    const uniqueId = `UrlLoader_${md5(url)}`

    logger.debug(`Loading URL ${url} for item ${itemId}`)

    if (!url || !this.isValidUrl(url)) {
      logger.warn(`Invalid URL: ${url}`)
      return {
        nodes: [],
        uniqueId,
        loaderType: 'UrlLoader'
      }
    }

    const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
    const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

    try {
      // Use embedjs WebLoader to fetch and parse the URL
      const webLoader = new EmbedjsWebLoader({
        urlOrContent: url,
        chunkSize,
        chunkOverlap
      })

      // Collect all chunks from the loader
      const documents: Document[] = []
      for await (const chunk of webLoader.getUnfilteredChunks()) {
        documents.push(
          new Document({
            text: chunk.pageContent,
            metadata: {
              ...chunk.metadata,
              source: url,
              type: 'url'
            }
          })
        )
      }

      if (documents.length === 0) {
        logger.warn(`No content extracted from URL: ${url}`)
        return {
          nodes: [],
          uniqueId,
          loaderType: 'UrlLoader'
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

      logger.debug(`URL ${url} loaded with ${nodes.length} chunks`)

      return {
        nodes,
        uniqueId,
        loaderType: 'UrlLoader'
      }
    } catch (error) {
      logger.error(`Failed to load URL ${url}:`, error as Error)
      throw error
    }
  }

  /**
   * Estimate workload for URL loading
   * URLs have variable content size, use a fixed estimate of 2MB
   */
  estimateWorkload(_context: LoaderContext): number {
    return 2 * MB
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
