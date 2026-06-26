import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { Document } from '@vectorstores/core'
import { describe, expect, it } from 'vitest'

import { chunkKnowledgeDocuments } from '../chunk'

const KNOWLEDGE_BASE_ID = '11111111-1111-4111-8111-111111111111'

function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: KNOWLEDGE_BASE_ID,
    name: 'KB',
    groupId: null,
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    status: 'completed',
    error: null,
    chunkSize: 1000,
    chunkOverlap: 0,
    chunkStrategy: 'structured',
    chunkSeparator: '\\n\\n',
    searchMode: 'hybrid',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...overrides
  }
}

describe('chunkKnowledgeDocuments', () => {
  it('returns empty content and no chunks when there are no source documents', () => {
    expect(chunkKnowledgeDocuments(createBase(), [])).toEqual({ contentText: '', chunks: [] })
  })

  it('joins documents with a blank line and assigns sequential unit indexes', () => {
    const documents = [
      new Document({ text: 'alpha', metadata: { source: 'a' } }),
      new Document({ text: 'beta', metadata: { source: 'b' } })
    ]

    const { contentText, chunks } = chunkKnowledgeDocuments(createBase(), documents)

    expect(contentText).toBe('alpha\n\nbeta')
    expect(chunks.map((chunk) => chunk.text)).toEqual(['alpha', 'beta'])
    expect(chunks.map((chunk) => chunk.unitIndex)).toEqual([0, 1])
    // The second document's offsets are shifted past the separator.
    expect(contentText.slice(chunks[1].charStart, chunks[1].charEnd)).toBe('beta')
  })

  it('keeps every chunk a verbatim slice of the joined content text', () => {
    const documents = [
      new Document({ text: 'Hello world. This is the very first document body.', metadata: { source: 'a' } }),
      new Document({ text: 'Second document here. It also has several sentences inside.', metadata: { source: 'b' } })
    ]

    const { contentText, chunks } = chunkKnowledgeDocuments(createBase({ chunkSize: 6, chunkOverlap: 1 }), documents)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((chunk) => chunk.unitIndex)).toEqual(chunks.map((_, index) => index))
    for (const chunk of chunks) {
      expect(contentText.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
    }
  })
})
