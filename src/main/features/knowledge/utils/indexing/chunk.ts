import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { Document as VectorStoreDocument } from '@vectorstores/core'

import { splitTextWithOffsets } from './splitter'

/** Inserted between source documents when concatenating them into one canonical content text. */
export const DOCUMENT_SEPARATOR = '\n\n'

/** One retrieval chunk with its offsets into the material's canonical `contentText`. */
export interface KnowledgeContentChunk {
  unitIndex: number
  charStart: number
  charEnd: number
  text: string
}

/**
 * The chunked form of a knowledge item: one canonical `contentText` (every
 * source document concatenated) plus the chunks, whose offsets index into that
 * text. The index store keeps `contentText` once and derives each unit's body by
 * slicing it, so the invariant `contentText.slice(charStart, charEnd) === text`
 * must hold — it does by construction (see {@link splitTextWithOffsets}).
 */
export interface ChunkedKnowledgeContent {
  contentText: string
  chunks: KnowledgeContentChunk[]
}

/**
 * Split a knowledge item's documents into structure-aware chunks carrying exact
 * source offsets. Each document is chunked independently and its offsets are
 * shifted by its base offset within the concatenation, so a chunk never spans a
 * document boundary while every chunk still maps back into the joined
 * `contentText`.
 */
export function chunkKnowledgeDocuments(
  base: KnowledgeBase,
  documents: VectorStoreDocument[]
): ChunkedKnowledgeContent {
  const options = {
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    separator: base.chunkSeparator,
    strategy: base.chunkStrategy
  }
  const parts: string[] = []
  const chunks: KnowledgeContentChunk[] = []
  let baseOffset = 0
  let unitIndex = 0

  documents.forEach((document, index) => {
    if (index > 0) {
      baseOffset += DOCUMENT_SEPARATOR.length
    }
    for (const chunk of splitTextWithOffsets(document.text, options)) {
      chunks.push({
        unitIndex: unitIndex,
        charStart: baseOffset + chunk.start,
        charEnd: baseOffset + chunk.end,
        text: chunk.text
      })
      unitIndex += 1
    }
    parts.push(document.text)
    baseOffset += document.text.length
  })

  return { contentText: parts.join(DOCUMENT_SEPARATOR), chunks }
}
