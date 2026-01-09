/**
 * URL Reader for KnowledgeServiceV2
 *
 * Handles reading web URLs and converting them to vectorstores nodes.
 * Uses fetch + HTMLReader for content extraction.
 */

import { loggerService } from '@logger'
import type { Document } from '@vectorstores/core'
import { SentenceSplitter } from '@vectorstores/core'
import { HTMLReader } from '@vectorstores/readers/html'
import md5 from 'md5'

import {
  type ContentReader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  MB,
  type ReaderContext,
  type ReaderResult
} from '../types'

const logger = loggerService.withContext('UrlReader')

/**
 * Reader for web URLs
 */
export class UrlReader implements ContentReader {
  readonly type = 'url' as const

  /**
   * Read URL content and split into chunks
   */
  async read(context: ReaderContext): Promise<ReaderResult> {
    const { base, item, itemId } = context
    const url = item.content as string

    const uniqueId = `UrlReader_${md5(url)}`

    logger.debug(`Reading URL ${url} for item ${itemId}`)

    if (!url || !this.isValidUrl(url)) {
      logger.warn(`Invalid URL: ${url}`)
      return {
        nodes: [],
        uniqueId,
        readerType: 'UrlReader'
      }
    }

    const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
    const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

    try {
      // 1. Fetch URL content
      logger.info(`Fetching URL: ${url}`)
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      const html = await response.text()

      // 2. Parse HTML with HTMLReader
      logger.info(`Parsing HTML content from URL: ${url}`)
      const reader = new HTMLReader()
      const rawDocuments = await reader.loadDataAsContent(new TextEncoder().encode(html))

      // 3. Normalize documents
      const documents = rawDocuments
        .map((doc) => {
          doc.metadata = {
            ...doc.metadata,
            source: url,
            type: 'url'
          }
          return doc as Document
        })
        .filter((doc) => doc.getText().trim().length > 0)

      logger.info(`HTMLReader extracted ${documents.length} documents from ${url}`)

      if (documents.length === 0) {
        logger.warn(`No content extracted from URL: ${url}`)
        return {
          nodes: [],
          uniqueId,
          readerType: 'UrlReader'
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

      logger.debug(`URL ${url} read with ${nodes.length} chunks`)

      return {
        nodes,
        uniqueId,
        readerType: 'UrlReader'
      }
    } catch (error) {
      logger.error(`Failed to read URL ${url}:`, error as Error)
      throw error
    }
  }

  /**
   * Estimate workload for URL reading
   * URLs have variable content size, use a fixed estimate of 2MB
   */
  estimateWorkload(_context: ReaderContext): number {
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
