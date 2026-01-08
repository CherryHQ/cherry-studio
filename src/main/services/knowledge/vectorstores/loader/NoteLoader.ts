/**
 * Note Loader for KnowledgeServiceV2
 *
 * Handles loading text notes and converting them to vectorstores nodes.
 */

import { loggerService } from '@logger'
import { Document, SentenceSplitter } from '@vectorstores/core'
import md5 from 'md5'

import {
  type ContentLoader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type LoaderContext,
  type LoaderResult
} from '../types'

const logger = loggerService.withContext('NoteLoader')

/**
 * Loader for text notes
 */
export class NoteLoader implements ContentLoader {
  readonly type = 'note' as const

  /**
   * Load note content and split into chunks
   */
  async load(context: LoaderContext): Promise<LoaderResult> {
    const { base, item, itemId } = context
    const content = item.content as string
    const sourceUrl = (item as { sourceUrl?: string }).sourceUrl

    const uniqueId = `NoteLoader_${md5(content + (sourceUrl || ''))}`

    logger.debug(`Loading note for item ${itemId}, content length: ${content.length}`)

    if (!content || content.trim().length === 0) {
      logger.warn(`Empty note content for item ${itemId}`)
      return {
        nodes: [],
        uniqueId,
        loaderType: 'NoteLoader'
      }
    }

    // Create initial document
    const document = new Document({
      text: content,
      metadata: {
        source: sourceUrl || 'note',
        type: 'note'
      }
    })

    // Split into chunks
    const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
    const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

    const splitter = new SentenceSplitter({ chunkSize, chunkOverlap })
    const nodes = splitter.getNodesFromDocuments([document])

    // Add external_id to all nodes
    nodes.forEach((node) => {
      node.metadata = {
        ...node.metadata,
        external_id: itemId
      }
    })

    logger.debug(`Note split into ${nodes.length} chunks for item ${itemId}`)

    return {
      nodes,
      uniqueId,
      loaderType: 'NoteLoader'
    }
  }

  /**
   * Estimate workload based on content length
   */
  estimateWorkload(context: LoaderContext): number {
    const content = context.item.content as string
    const encoder = new TextEncoder()
    return encoder.encode(content).length
  }
}
