import { describe, expect, it } from 'vitest'

import {
  ListKnowledgeBasesQuerySchema,
  ListKnowledgeItemsQuerySchema,
  UpdateKnowledgeBaseSchema
} from '../data/api/schemas/knowledges'
import {
  CreateKnowledgeBaseSchema,
  CreateKnowledgeItemsSchema,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  KnowledgeBaseSchema,
  KnowledgeItemSchema,
  KnowledgeRuntimeAddItemInputSchema,
  UpdateKnowledgeItemSchema
} from '../data/types/knowledge'

describe('Knowledge base schemas', () => {
  it('accepts valid numeric tuning fields', () => {
    const result = CreateKnowledgeBaseSchema.safeParse({
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model',
      groupId: '  group-1  ',
      emoji: '📚',
      chunkSize: 800,
      chunkOverlap: 120,
      threshold: 0.5,
      documentCount: 5,
      searchMode: 'hybrid',
      hybridAlpha: 0.7
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.groupId).toBe('  group-1  ')
    }
  })

  it('applies hybrid as the default search mode in create schema', () => {
    const result = CreateKnowledgeBaseSchema.safeParse({
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model'
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.searchMode).toBe('hybrid')
    }
  })

  it('rejects invalid numeric tuning fields in create schema', () => {
    const result = CreateKnowledgeBaseSchema.safeParse({
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model',
      chunkSize: 0,
      chunkOverlap: -1,
      threshold: 2,
      documentCount: 0,
      hybridAlpha: -0.1
    })

    expect(result.success).toBe(false)
  })

  it('rejects invalid create chunk relationships', () => {
    expect(
      CreateKnowledgeBaseSchema.safeParse({
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        chunkOverlap: 120
      }).success
    ).toBe(false)

    expect(
      CreateKnowledgeBaseSchema.safeParse({
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        chunkSize: 120,
        chunkOverlap: 120
      }).success
    ).toBe(false)
  })

  it('rejects extra fields in create schema', () => {
    const result = CreateKnowledgeBaseSchema.safeParse({
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model',
      createdAt: '2026-04-10T00:00:00.000Z'
    })

    expect(result.success).toBe(false)
  })

  it('validates create-item DTO item shapes', () => {
    expect(CreateKnowledgeItemsSchema.safeParse({ items: [] }).success).toBe(false)

    expect(
      CreateKnowledgeItemsSchema.safeParse({
        items: [
          {
            type: 'note',
            data: { source: 'hello', content: 'hello' }
          }
        ]
      }).success
    ).toBe(true)
  })

  it('accepts runtime add-item caller-friendly shapes', () => {
    expect(
      KnowledgeRuntimeAddItemInputSchema.safeParse({
        type: 'url',
        url: ' https://example.com/docs ',
        groupId: null
      }).success
    ).toBe(true)

    expect(
      KnowledgeRuntimeAddItemInputSchema.safeParse({
        type: 'file',
        file: {
          id: 'file-1',
          name: 'guide.md',
          origin_name: 'guide.md',
          path: '/docs/guide.md',
          size: 12,
          ext: '.md',
          type: 'text',
          created_at: '2026-04-10T00:00:00.000Z',
          count: 1
        }
      }).success
    ).toBe(true)

    expect(
      KnowledgeRuntimeAddItemInputSchema.safeParse({
        type: 'url',
        url: 'https://example.com/docs',
        name: 'Docs'
      }).success
    ).toBe(false)

    expect(
      KnowledgeRuntimeAddItemInputSchema.safeParse({
        type: 'note',
        content: 'hello',
        source: 'note-1'
      }).success
    ).toBe(true)

    expect(
      KnowledgeRuntimeAddItemInputSchema.safeParse({
        type: 'note',
        data: { source: 'hello', content: 'hello' }
      }).success
    ).toBe(false)
  })

  it('rejects extra fields in create-items and list query schemas', () => {
    expect(
      CreateKnowledgeItemsSchema.safeParse({
        items: [
          {
            type: 'note',
            data: { source: 'hello', content: 'hello' }
          }
        ],
        extra: true
      }).success
    ).toBe(false)

    expect(ListKnowledgeBasesQuerySchema.safeParse({ page: 1, limit: 20, extra: true }).success).toBe(false)
    expect(ListKnowledgeItemsQuerySchema.safeParse({ page: 1, limit: 20, type: 'note', extra: true }).success).toBe(
      false
    )
  })

  it('rejects invalid numeric tuning fields in update schema', () => {
    const result = UpdateKnowledgeBaseSchema.safeParse({
      chunkSize: -10,
      chunkOverlap: -1,
      threshold: 1.1,
      documentCount: 0,
      hybridAlpha: 2
    })

    expect(result.success).toBe(false)
  })

  it('rejects invalid numeric tuning fields in entity schema', () => {
    const result = KnowledgeBaseSchema.safeParse({
      id: 'kb-1',
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model',
      groupId: null,
      emoji: '📁',
      chunkSize: 0,
      chunkOverlap: -1,
      threshold: 2,
      documentCount: 0,
      hybridAlpha: 2,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    })

    expect(result.success).toBe(false)
  })

  it('accepts nullable groupId and applies default emoji in entity schema', () => {
    const result = KnowledgeBaseSchema.safeParse({
      id: 'kb-1',
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model',
      groupId: null,
      chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.emoji).toBe('📁')
    }
  })

  it('requires chunk config to be present in entity schema', () => {
    expect(
      KnowledgeBaseSchema.safeParse({
        id: 'kb-1',
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(false)
  })

  it('rejects invalid knowledge base emoji values', () => {
    expect(
      CreateKnowledgeBaseSchema.safeParse({
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        emoji: 'books'
      }).success
    ).toBe(false)

    expect(
      UpdateKnowledgeBaseSchema.safeParse({
        emoji: 'books'
      }).success
    ).toBe(false)

    expect(
      CreateKnowledgeBaseSchema.safeParse({
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        emoji: '  📚  '
      }).success
    ).toBe(false)

    expect(
      UpdateKnowledgeBaseSchema.safeParse({
        emoji: '   '
      }).success
    ).toBe(false)

    expect(
      KnowledgeBaseSchema.safeParse({
        id: 'kb-1',
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        emoji: 'books',
        chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
        chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(false)
  })

  it('requires knowledge items to carry an explicit nullable error field', () => {
    expect(
      KnowledgeItemSchema.safeParse({
        id: 'item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { source: 'hello', content: 'hello' },
        status: 'idle',
        phase: null,
        error: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(true)

    expect(
      KnowledgeItemSchema.safeParse({
        id: 'item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { source: 'hello', content: 'hello' },
        status: 'idle',
        phase: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(false)
  })

  it('separates knowledge item status from runtime phase', () => {
    expect(
      KnowledgeItemSchema.safeParse({
        id: 'item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { source: 'hello', content: 'hello' },
        status: 'processing',
        phase: 'reading',
        error: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(true)

    expect(
      KnowledgeItemSchema.safeParse({
        id: 'item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: { source: 'hello', content: 'hello' },
        status: 'read',
        phase: null,
        error: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(false)
  })

  it('keeps runtime phase out of generic knowledge item updates', () => {
    expect(
      UpdateKnowledgeItemSchema.safeParse({
        status: 'processing',
        phase: 'reading'
      }).success
    ).toBe(false)

    expect(
      UpdateKnowledgeItemSchema.safeParse({
        status: 'failed',
        error: 'read failed'
      }).success
    ).toBe(true)
  })
})

it('allows migrated knowledge bases to have a null embedding model id', () => {
  const result = KnowledgeBaseSchema.safeParse({
    id: 'kb-null-model',
    name: 'KB nullable model',
    dimensions: 1024,
    embeddingModelId: null,
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z'
  })

  expect(result.success).toBe(true)
})

it('rejects embedding model changes in patch schema', () => {
  expect(UpdateKnowledgeBaseSchema.safeParse({ embeddingModelId: 'openai::text-embedding-3-small' }).success).toBe(
    false
  )
  expect(UpdateKnowledgeBaseSchema.safeParse({ embeddingModelId: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({}).success).toBe(true)
})

it('rejects chunk config null clears in patch schema', () => {
  expect(UpdateKnowledgeBaseSchema.safeParse({ chunkSize: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ chunkOverlap: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ chunkSize: 1024, chunkOverlap: 200 }).success).toBe(true)
})

it('keeps patch groupId aligned with topic semantics', () => {
  expect(UpdateKnowledgeBaseSchema.safeParse({ groupId: null }).success).toBe(true)
  expect(UpdateKnowledgeBaseSchema.safeParse({ groupId: '  group-1  ' }).success).toBe(true)
  expect(UpdateKnowledgeBaseSchema.safeParse({ emoji: null }).success).toBe(false)
})
