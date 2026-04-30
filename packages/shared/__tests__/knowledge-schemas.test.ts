import { describe, expect, it } from 'vitest'

import {
  ListKnowledgeBasesQuerySchema,
  ListKnowledgeItemsQuerySchema,
  UpdateKnowledgeBaseSchema
} from '../data/api/schemas/knowledges'
import {
  CreateKnowledgeBaseSchema,
  CreateKnowledgeItemSchema,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  KnowledgeBaseSchema,
  KnowledgeItemSchema,
  KnowledgeRuntimeAddItemInputSchema
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
      expect(result.data.groupId).toBe('group-1')
    }
  })

  it('rejects blank create group ids', () => {
    expect(
      CreateKnowledgeBaseSchema.safeParse({
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        groupId: '   '
      }).success
    ).toBe(false)
  })

  it('does not apply product defaults in create schema', () => {
    const result = CreateKnowledgeBaseSchema.safeParse({
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model'
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('emoji')
      expect(result.data).not.toHaveProperty('searchMode')
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
    expect(
      CreateKnowledgeItemSchema.safeParse({
        type: 'note',
        data: { source: 'hello', content: 'hello' }
      }).success
    ).toBe(true)
  })

  it('uses create-item DTO shapes for runtime add-item inputs', () => {
    expect(
      KnowledgeRuntimeAddItemInputSchema.safeParse({
        type: 'url',
        data: { source: 'https://example.com/docs', url: 'https://example.com/docs' },
        groupId: null
      }).success
    ).toBe(true)

    expect(
      KnowledgeRuntimeAddItemInputSchema.safeParse({
        type: 'file',
        data: {
          source: '/docs/guide.md',
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
        data: { source: 'hello', content: 'hello' }
      }).success
    ).toBe(true)

    expect(
      KnowledgeRuntimeAddItemInputSchema.safeParse({
        type: 'note',
        content: 'hello',
        source: 'note-1'
      }).success
    ).toBe(false)
  })

  it('rejects extra fields in create-item and list query schemas', () => {
    expect(
      CreateKnowledgeItemSchema.safeParse({
        type: 'note',
        data: { source: 'hello', content: 'hello' },
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

  it('accepts nullable groupId and requires persisted defaults in entity schema', () => {
    const result = KnowledgeBaseSchema.safeParse({
      id: 'kb-1',
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model',
      groupId: null,
      emoji: '📁',
      chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      searchMode: 'hybrid',
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.emoji).toBe('📁')
      expect(result.data.searchMode).toBe('hybrid')
    }
  })

  it('requires persisted config to be present in entity schema', () => {
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

    expect(
      KnowledgeBaseSchema.safeParse({
        id: 'kb-1',
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        emoji: '📁',
        chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
        chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
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

  it('rejects invalid knowledge item status phase error combinations', () => {
    const validItem = {
      id: 'item-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'note' as const,
      data: { source: 'hello', content: 'hello' },
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    }

    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'idle', phase: null, error: null }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'completed', phase: null, error: null }).success).toBe(
      true
    )
    expect(
      KnowledgeItemSchema.safeParse({ ...validItem, status: 'processing', phase: null, error: null }).success
    ).toBe(true)
    expect(
      KnowledgeItemSchema.safeParse({ ...validItem, status: 'processing', phase: 'reading', error: null }).success
    ).toBe(true)
    expect(
      KnowledgeItemSchema.safeParse({ ...validItem, status: 'failed', phase: null, error: 'read failed' }).success
    ).toBe(true)

    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'idle', phase: 'reading', error: null }).success).toBe(
      false
    )
    expect(
      KnowledgeItemSchema.safeParse({ ...validItem, status: 'completed', phase: null, error: 'stale' }).success
    ).toBe(false)
    expect(
      KnowledgeItemSchema.safeParse({ ...validItem, status: 'processing', phase: null, error: 'stale' }).success
    ).toBe(false)
    expect(
      KnowledgeItemSchema.safeParse({ ...validItem, status: 'failed', phase: 'reading', error: 'read failed' }).success
    ).toBe(false)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'failed', phase: null, error: '' }).success).toBe(
      false
    )
  })

  it('restricts processing phase by knowledge item type', () => {
    const leafItem = {
      id: 'leaf-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'note' as const,
      data: { source: 'leaf', content: 'leaf content' },
      status: 'processing' as const,
      error: null,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    }
    const containerItem = {
      id: 'container-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'directory' as const,
      data: { source: '/docs', path: '/docs' },
      status: 'processing' as const,
      error: null,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    }

    expect(KnowledgeItemSchema.safeParse({ ...leafItem, phase: null }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...leafItem, phase: 'reading' }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...leafItem, phase: 'embedding' }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...leafItem, phase: 'preparing' }).success).toBe(false)

    expect(KnowledgeItemSchema.safeParse({ ...containerItem, phase: null }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...containerItem, phase: 'preparing' }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...containerItem, phase: 'reading' }).success).toBe(false)
    expect(KnowledgeItemSchema.safeParse({ ...containerItem, phase: 'embedding' }).success).toBe(false)
  })
})

it('rejects knowledge bases with a null embedding model id', () => {
  const result = KnowledgeBaseSchema.safeParse({
    id: 'kb-null-model',
    name: 'KB nullable model',
    dimensions: 1024,
    embeddingModelId: null,
    emoji: '📁',
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    searchMode: 'hybrid',
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z'
  })

  expect(result.success).toBe(false)
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
  expect(UpdateKnowledgeBaseSchema.safeParse({ searchMode: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ chunkSize: 1024, chunkOverlap: 200 }).success).toBe(true)
})

it('keeps patch groupId aligned with topic semantics', () => {
  expect(UpdateKnowledgeBaseSchema.safeParse({ groupId: null }).success).toBe(true)
  expect(UpdateKnowledgeBaseSchema.safeParse({ groupId: '  group-1  ' }).success).toBe(true)
  expect(UpdateKnowledgeBaseSchema.safeParse({ groupId: '   ' }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ emoji: null }).success).toBe(false)
})
