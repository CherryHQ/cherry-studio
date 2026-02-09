/**
 * Note Reader for KnowledgeServiceV2
 *
 * Handles reading text notes and converting them to vectorstores nodes.
 */

import { loggerService } from '@logger'
import type { NoteItemData } from '@shared/data/types/knowledge'
import { Document } from '@vectorstores/core'

import { TextChunkSplitter } from '../splitters/TextChunkSplitter'
import {
  type ContentReader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type ReaderContext,
  type ReaderResult
} from '../types'
import { applyNodeMetadata } from './utils'

const logger = loggerService.withContext('NoteReader')

/**
 * Reader for text notes
 */
export class NoteReader implements ContentReader {
  readonly type = 'note' as const

  /**
   * Read note content and split into chunks
   */
  async read(context: ReaderContext): Promise<ReaderResult> {
    const { base, item } = context
    const noteData = item.data as NoteItemData
    const content = noteData.content
    const sourceUrl = noteData.sourceUrl

    logger.debug(`Reading note for item ${item.id}, content length: ${content.length}`)

    if (!content || content.trim().length === 0) {
      logger.warn(`Empty note content for item ${item.id}`)
      return { nodes: [] }
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

    const nodes = TextChunkSplitter([document], { chunkSize, chunkOverlap })

    applyNodeMetadata(nodes, { externalId: item.id })

    logger.debug(`Note split into ${nodes.length} chunks for item ${item.id}`)

    return { nodes }
  }
}
