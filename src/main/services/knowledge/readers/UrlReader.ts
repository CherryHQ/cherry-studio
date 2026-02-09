/**
 * URL Reader for KnowledgeServiceV2
 *
 * Handles reading web URLs and converting them to vectorstores nodes.
 * Uses fetch + HTMLReader for content extraction.
 */

import { loggerService } from '@logger'
import type { UrlItemData } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'
import { HTMLReader } from '@vectorstores/readers/html'

import { TextChunkSplitter } from '../splitters/TextChunkSplitter'
import {
  type ContentReader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type ReaderContext,
  type ReaderResult
} from '../types'
import { applyNodeMetadata } from './utils'

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
    const { base, item } = context
    const urlData = item.data as UrlItemData
    const url = urlData.url

    logger.debug(`Reading URL ${url} for item ${item.id}`)

    if (!url || !this.isValidUrl(url)) {
      logger.warn(`Invalid URL: ${url}`)
      return { nodes: [] }
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
        return { nodes: [] }
      }

      // Split documents into chunks
      const nodes = TextChunkSplitter(documents, { chunkSize, chunkOverlap })

      applyNodeMetadata(nodes, { externalId: item.id })

      logger.debug(`URL ${url} read with ${nodes.length} chunks`)

      return { nodes }
    } catch (error) {
      logger.error(`Failed to read URL ${url}:`, error as Error)
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
