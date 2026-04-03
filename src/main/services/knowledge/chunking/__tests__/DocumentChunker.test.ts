import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { Document } from '@vectorstores/core'
import { describe, expect, it } from 'vitest'

import { DocumentChunker } from '../DocumentChunker'

const base = {
  chunkSize: 10,
  chunkOverlap: 2
}

const noteItem: KnowledgeItem = {
  id: 'note-1',
  baseId: 'base-1',
  groupId: null,
  type: 'note',
  status: 'idle',
  error: null,
  createdAt: '2026-04-03T00:00:00.000Z',
  updatedAt: '2026-04-03T00:00:00.000Z',
  data: {
    content: 'hello world from note',
    sourceUrl: 'https://example.com/note'
  }
}

describe('DocumentChunker', () => {
  it('splits documents using the knowledge base chunk configuration', () => {
    const documents = [
      new Document({
        text: 'abcdefghij klmnopqrst uvwxyz',
        metadata: {
          sourceUrl: 'https://example.com'
        }
      })
    ]

    const chunks = DocumentChunker.chunk(base, noteItem, documents)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({
      metadata: {
        itemId: 'note-1',
        itemType: 'note',
        sourceDocumentIndex: 0,
        chunkIndex: 0,
        chunkCount: chunks.length,
        sourceUrl: 'https://example.com'
      }
    })
  })
})
