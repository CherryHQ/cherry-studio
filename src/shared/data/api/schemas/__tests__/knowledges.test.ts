import { describe, expect, it } from 'vitest'

import {
  CreateKnowledgeBaseSchema,
  CreateKnowledgeItemSchema,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  isCompletedKnowledgeBase,
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KnowledgeAddItemInputSchema,
  type KnowledgeBase,
  KnowledgeBaseSchema,
  KnowledgeItemSchema,
  RestoreKnowledgeBaseSchema
} from '../../../types/knowledge'
import { ListKnowledgeBasesQuerySchema, ListKnowledgeItemsQuerySchema, UpdateKnowledgeBaseSchema } from '../knowledges'

const KNOWLEDGE_BASE_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_KNOWLEDGE_BASE_ID = '22222222-2222-4222-8222-222222222222'
const SOURCE_KNOWLEDGE_BASE_ID = '33333333-3333-4333-8333-333333333333'
const KNOWLEDGE_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const CONTAINER_KNOWLEDGE_ITEM_ID = '0198f3f2-7d1c-7abc-8def-123456789abc'
const GROUP_ID = '44444444-4444-4444-8444-444444444444'

describe('Knowledge base schemas', () => {
  it('accepts valid numeric tuning fields', () => {
    const result = CreateKnowledgeBaseSchema.safeParse({
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model',
      groupId: GROUP_ID,
      chunkSize: 800,
      chunkOverlap: 120,
      threshold: 0.5,
      documentCount: 5,
      searchMode: 'hybrid',
      hybridAlpha: 0.7
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.groupId).toBe(GROUP_ID)
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

  it('validates restore-base DTOs', () => {
    const result = RestoreKnowledgeBaseSchema.safeParse({
      sourceBaseId: SOURCE_KNOWLEDGE_BASE_ID,
      name: '  Base 1_bak  ',
      dimensions: 3072,
      embeddingModelId: 'openai::text-embedding-3-large'
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Base 1_bak')
    }
  })

  it('rejects extra fields in restore-base DTOs', () => {
    expect(
      RestoreKnowledgeBaseSchema.safeParse({
        sourceBaseId: SOURCE_KNOWLEDGE_BASE_ID,
        dimensions: 3072,
        embeddingModelId: 'openai::text-embedding-3-large',
        chunkSize: 800
      }).success
    ).toBe(false)
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
      KnowledgeAddItemInputSchema.safeParse({
        type: 'url',
        data: { source: 'https://example.com/docs', url: 'https://example.com/docs' },
        groupId: null
      }).success
    ).toBe(true)

    expect(
      KnowledgeAddItemInputSchema.safeParse({
        type: 'file',
        data: {
          source: '/docs/guide.md',
          path: '/docs/guide.md'
        }
      }).success
    ).toBe(true)

    expect(
      CreateKnowledgeItemSchema.safeParse({
        type: 'file',
        data: {
          source: '/docs/guide.md',
          path: '/docs/guide.md'
        }
      }).success
    ).toBe(false)

    expect(
      KnowledgeAddItemInputSchema.safeParse({
        type: 'file',
        data: {
          source: '/docs/guide.md',
          path: 'docs/guide.md'
        }
      }).success
    ).toBe(false)

    expect(
      KnowledgeAddItemInputSchema.safeParse({
        type: 'url',
        url: 'https://example.com/docs',
        name: 'Docs'
      }).success
    ).toBe(false)

    expect(
      KnowledgeAddItemInputSchema.safeParse({
        type: 'note',
        data: { source: 'hello', content: 'hello' }
      }).success
    ).toBe(true)

    expect(
      KnowledgeAddItemInputSchema.safeParse({
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
      id: KNOWLEDGE_BASE_ID,
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model',
      groupId: null,
      status: 'completed',
      error: null,
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
      id: KNOWLEDGE_BASE_ID,
      name: 'KB',
      dimensions: 1024,
      embeddingModelId: 'embed-model',
      groupId: null,
      status: 'completed',
      error: null,
      chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      searchMode: 'hybrid',
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.searchMode).toBe('hybrid')
    }
  })

  it('requires completed bases to have positive dimensions and allows failed bases with unknown dimensions', () => {
    const failedBase = {
      id: KNOWLEDGE_BASE_ID,
      name: 'KB',
      embeddingModelId: null,
      groupId: null,
      status: 'failed',
      error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
      chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      searchMode: 'hybrid',
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    }
    const completedBase = {
      ...failedBase,
      embeddingModelId: 'embed-model',
      status: 'completed',
      error: null
    }

    expect(KnowledgeBaseSchema.safeParse({ ...completedBase, dimensions: null }).success).toBe(false)
    expect(KnowledgeBaseSchema.safeParse({ ...completedBase, dimensions: 0 }).success).toBe(false)
    expect(KnowledgeBaseSchema.safeParse({ ...failedBase, dimensions: null }).success).toBe(true)
    expect(KnowledgeBaseSchema.safeParse({ ...failedBase, dimensions: 0 }).success).toBe(false)
    expect(KnowledgeBaseSchema.safeParse({ ...failedBase, dimensions: 768 }).success).toBe(true)
  })

  it('requires persisted config to be present in entity schema', () => {
    expect(
      KnowledgeBaseSchema.safeParse({
        id: KNOWLEDGE_BASE_ID,
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        status: 'completed',
        error: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(false)

    expect(
      KnowledgeBaseSchema.safeParse({
        id: KNOWLEDGE_BASE_ID,
        name: 'KB',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        status: 'completed',
        error: null,
        chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
        chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
        searchMode: 'hybrid',
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(false)
  })

  it('requires knowledge items to carry an explicit nullable error field', () => {
    expect(
      KnowledgeItemSchema.safeParse({
        id: KNOWLEDGE_ITEM_ID,
        baseId: KNOWLEDGE_BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: 'hello', content: 'hello' },
        status: 'idle',
        error: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(true)

    expect(
      KnowledgeItemSchema.safeParse({
        id: KNOWLEDGE_ITEM_ID,
        baseId: KNOWLEDGE_BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: 'hello', content: 'hello' },
        status: 'idle',
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(false)
  })

  it('uses status for knowledge item runtime progress', () => {
    expect(
      KnowledgeItemSchema.safeParse({
        id: KNOWLEDGE_ITEM_ID,
        baseId: KNOWLEDGE_BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: 'hello', content: 'hello' },
        status: 'reading',
        error: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(true)

    expect(
      KnowledgeItemSchema.safeParse({
        id: KNOWLEDGE_ITEM_ID,
        baseId: KNOWLEDGE_BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: 'hello', content: 'hello' },
        status: 'read',
        error: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z'
      }).success
    ).toBe(false)
  })

  it('rejects invalid knowledge item status error combinations', () => {
    const validItem = {
      id: KNOWLEDGE_ITEM_ID,
      baseId: KNOWLEDGE_BASE_ID,
      groupId: null,
      type: 'note' as const,
      data: { source: 'hello', content: 'hello' },
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    }

    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'idle', error: null }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'completed', error: null }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'processing', error: null }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'reading', error: null }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'embedding', error: null }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'failed', error: 'read failed' }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'deleting', error: null }).success).toBe(true)

    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'idle', phase: 'reading', error: null }).success).toBe(
      false
    )
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'completed', error: 'stale' }).success).toBe(false)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'processing', error: 'stale' }).success).toBe(false)
    expect(
      KnowledgeItemSchema.safeParse({ ...validItem, status: 'failed', phase: 'reading', error: 'read failed' }).success
    ).toBe(false)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'failed', error: '' }).success).toBe(false)
    expect(KnowledgeItemSchema.safeParse({ ...validItem, status: 'deleting', error: 'stale' }).success).toBe(false)
  })

  it('restricts progress statuses by knowledge item type', () => {
    const leafItem = {
      id: KNOWLEDGE_ITEM_ID,
      baseId: KNOWLEDGE_BASE_ID,
      groupId: null,
      type: 'note' as const,
      data: { source: 'leaf', content: 'leaf content' },
      status: 'processing' as const,
      error: null,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    }
    const containerItem = {
      id: CONTAINER_KNOWLEDGE_ITEM_ID,
      baseId: KNOWLEDGE_BASE_ID,
      groupId: null,
      type: 'directory' as const,
      data: { source: '/docs', path: '/docs' },
      status: 'processing' as const,
      error: null,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z'
    }

    expect(KnowledgeItemSchema.safeParse({ ...leafItem }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...leafItem, status: 'reading' }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...leafItem, status: 'embedding' }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...leafItem, status: 'preparing' }).success).toBe(false)

    expect(KnowledgeItemSchema.safeParse({ ...containerItem }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...containerItem, status: 'preparing' }).success).toBe(true)
    expect(KnowledgeItemSchema.safeParse({ ...containerItem, status: 'reading' }).success).toBe(false)
    expect(KnowledgeItemSchema.safeParse({ ...containerItem, status: 'embedding' }).success).toBe(false)
  })
})

it('accepts failed knowledge bases with a null embedding model id', () => {
  const result = KnowledgeBaseSchema.safeParse({
    id: SECOND_KNOWLEDGE_BASE_ID,
    name: 'KB nullable model',
    dimensions: 1024,
    embeddingModelId: null,
    groupId: null,
    status: 'failed',
    error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    searchMode: 'hybrid',
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z'
  })

  expect(result.success).toBe(true)
})

it('rejects invalid knowledge base status error combinations', () => {
  const validBase = {
    id: KNOWLEDGE_BASE_ID,
    name: 'KB',
    dimensions: 1024,
    groupId: null,
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    searchMode: 'hybrid' as const,
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z'
  }

  expect(
    KnowledgeBaseSchema.safeParse({
      ...validBase,
      embeddingModelId: 'embed-model',
      status: 'completed',
      error: null
    }).success
  ).toBe(true)
  expect(
    KnowledgeBaseSchema.safeParse({
      ...validBase,
      embeddingModelId: null,
      status: 'completed',
      error: null
    }).success
  ).toBe(false)
  expect(
    KnowledgeBaseSchema.safeParse({
      ...validBase,
      embeddingModelId: 'embed-model',
      status: 'completed',
      error: 'stale'
    }).success
  ).toBe(false)
  expect(
    KnowledgeBaseSchema.safeParse({
      ...validBase,
      embeddingModelId: null,
      status: 'failed',
      error: null
    }).success
  ).toBe(false)
  expect(
    KnowledgeBaseSchema.safeParse({
      ...validBase,
      embeddingModelId: null,
      status: 'failed',
      error: ''
    }).success
  ).toBe(false)
  expect(
    KnowledgeBaseSchema.safeParse({
      ...validBase,
      embeddingModelId: null,
      status: 'failed',
      error: 'unknown_error'
    }).success
  ).toBe(false)
})

it('rejects embedding model changes in patch schema', () => {
  expect(UpdateKnowledgeBaseSchema.safeParse({ embeddingModelId: 'openai::text-embedding-3-small' }).success).toBe(
    false
  )
  expect(UpdateKnowledgeBaseSchema.safeParse({ embeddingModelId: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({}).success).toBe(true)
})

it('accepts nullable model and processor clears in patch schema', () => {
  const result = UpdateKnowledgeBaseSchema.safeParse({
    rerankModelId: null,
    fileProcessorId: null
  })

  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data).toEqual({
      rerankModelId: null,
      fileProcessorId: null
    })
  }
})

it('rejects non-nullable optional config null clears in patch schema', () => {
  expect(UpdateKnowledgeBaseSchema.safeParse({ chunkSize: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ chunkOverlap: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ searchMode: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ threshold: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ documentCount: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ hybridAlpha: null }).success).toBe(false)
  expect(UpdateKnowledgeBaseSchema.safeParse({ chunkSize: 1024, chunkOverlap: 200 }).success).toBe(true)
  expect(
    UpdateKnowledgeBaseSchema.safeParse({
      rerankModelId: 'rerank-1',
      fileProcessorId: 'processor-1',
      threshold: 0.5,
      documentCount: 5,
      hybridAlpha: 0.7
    }).success
  ).toBe(true)
})

it('keeps patch groupId aligned with topic semantics', () => {
  expect(UpdateKnowledgeBaseSchema.safeParse({ groupId: null }).success).toBe(true)
  expect(UpdateKnowledgeBaseSchema.safeParse({ groupId: GROUP_ID }).success).toBe(true)
  expect(UpdateKnowledgeBaseSchema.safeParse({ groupId: '   ' }).success).toBe(false)
})

describe('isCompletedKnowledgeBase', () => {
  const completedBase = KnowledgeBaseSchema.parse({
    id: KNOWLEDGE_BASE_ID,
    name: 'KB',
    groupId: null,
    dimensions: 768,
    embeddingModelId: 'embed-model',
    status: 'completed',
    error: null,
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    searchMode: 'hybrid',
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z'
  })

  it('accepts a completed base with positive integer dimensions', () => {
    expect(isCompletedKnowledgeBase(completedBase)).toBe(true)
  })

  it('rejects a failed base with unknown dimensions', () => {
    const failedBase = KnowledgeBaseSchema.parse({
      ...completedBase,
      status: 'failed',
      embeddingModelId: null,
      dimensions: null,
      error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
    })

    expect(isCompletedKnowledgeBase(failedBase)).toBe(false)
  })

  it('rejects illegal completed states the schema would never produce', () => {
    expect(isCompletedKnowledgeBase({ ...completedBase, dimensions: null } as KnowledgeBase)).toBe(false)
    expect(isCompletedKnowledgeBase({ ...completedBase, dimensions: 0 } as KnowledgeBase)).toBe(false)
    expect(isCompletedKnowledgeBase({ ...completedBase, embeddingModelId: null } as KnowledgeBase)).toBe(false)
    expect(
      isCompletedKnowledgeBase({
        ...completedBase,
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
      } as KnowledgeBase)
    ).toBe(false)
  })
})
