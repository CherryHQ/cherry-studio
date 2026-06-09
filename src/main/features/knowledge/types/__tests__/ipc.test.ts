import { KNOWLEDGE_NOTE_CONTENT_MAX, KNOWLEDGE_RUNTIME_ITEMS_MAX } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import {
  KnowledgeAddItemsPayloadSchema,
  KnowledgeBasePayloadSchema,
  KnowledgeCreateBasePayloadSchema,
  KnowledgeDeleteItemChunkPayloadSchema,
  KnowledgeItemChunksPayloadSchema,
  KnowledgeItemsPayloadSchema,
  KnowledgeRestoreBasePayloadSchema,
  KnowledgeSearchPayloadSchema
} from '../ipc'

const BASE_ID = '11111111-1111-4111-8111-111111111111'

const createBaseInput = () => ({
  name: 'Knowledge Base',
  dimensions: 1024,
  embeddingModelId: 'openai::text-embedding-3-large'
})

const createRuntimeItem = (index: number) => ({
  type: 'note' as const,
  data: {
    source: `note-${index}`,
    content: `note ${index}`
  }
})

const createPayload = (count: number) => ({
  baseId: 'base-1',
  itemIds: Array.from({ length: count }, (_, index) => `item-${index}`)
})

const createAddItemsPayload = (count: number) => ({
  baseId: 'base-1',
  items: Array.from({ length: count }, (_, index) => createRuntimeItem(index))
})

describe('knowledge runtime payload schemas', () => {
  it('accepts valid payloads for every runtime operation', () => {
    const cases = [
      { name: 'create base', schema: KnowledgeCreateBasePayloadSchema, payload: { base: createBaseInput() } },
      {
        name: 'restore base',
        schema: KnowledgeRestoreBasePayloadSchema,
        payload: {
          sourceBaseId: BASE_ID,
          name: 'Base 1_bak',
          dimensions: 3072,
          embeddingModelId: 'openai::text-embedding-3-large'
        }
      },
      { name: 'base', schema: KnowledgeBasePayloadSchema, payload: { baseId: 'base-1' } },
      { name: 'add items', schema: KnowledgeAddItemsPayloadSchema, payload: createAddItemsPayload(1) },
      { name: 'items', schema: KnowledgeItemsPayloadSchema, payload: createPayload(1) },
      { name: 'search', schema: KnowledgeSearchPayloadSchema, payload: { baseId: 'base-1', query: 'hello' } },
      {
        name: 'item chunks',
        schema: KnowledgeItemChunksPayloadSchema,
        payload: { baseId: 'base-1', itemId: 'item-1' }
      },
      {
        name: 'delete item chunk',
        schema: KnowledgeDeleteItemChunkPayloadSchema,
        payload: { baseId: 'base-1', itemId: 'item-1', chunkId: 'chunk-1' }
      }
    ]

    for (const { name, payload, schema } of cases) {
      expect(schema.safeParse(payload).success, name).toBe(true)
    }
  })

  it('rejects invalid payloads for every runtime operation', () => {
    const cases = [
      {
        name: 'create base',
        schema: KnowledgeCreateBasePayloadSchema,
        payload: { base: { ...createBaseInput(), name: '' } }
      },
      {
        name: 'restore base',
        schema: KnowledgeRestoreBasePayloadSchema,
        payload: { sourceBaseId: 'base-1', dimensions: 3072, embeddingModelId: '', chunkOverlap: 120 }
      },
      { name: 'base', schema: KnowledgeBasePayloadSchema, payload: { baseId: '' } },
      { name: 'add items', schema: KnowledgeAddItemsPayloadSchema, payload: createAddItemsPayload(0) },
      { name: 'items', schema: KnowledgeItemsPayloadSchema, payload: createPayload(0) },
      { name: 'search', schema: KnowledgeSearchPayloadSchema, payload: { baseId: 'base-1', query: '' } },
      {
        name: 'item chunks',
        schema: KnowledgeItemChunksPayloadSchema,
        payload: { baseId: 'base-1', itemId: '' }
      },
      {
        name: 'delete item chunk',
        schema: KnowledgeDeleteItemChunkPayloadSchema,
        payload: { baseId: 'base-1', itemId: 'item-1', chunkId: '' }
      }
    ]

    for (const { name, payload, schema } of cases) {
      expect(schema.safeParse(payload).success, name).toBe(false)
    }
  })
})

describe('KnowledgeAddItemsPayloadSchema', () => {
  it('accepts one runtime item', () => {
    expect(KnowledgeAddItemsPayloadSchema.safeParse(createAddItemsPayload(1)).success).toBe(true)
  })

  it('accepts runtime items at the runtime batch limit', () => {
    expect(KnowledgeAddItemsPayloadSchema.safeParse(createAddItemsPayload(KNOWLEDGE_RUNTIME_ITEMS_MAX)).success).toBe(
      true
    )
  })

  it('rejects empty runtime item lists', () => {
    expect(KnowledgeAddItemsPayloadSchema.safeParse(createAddItemsPayload(0)).success).toBe(false)
  })

  it('rejects runtime items above the runtime batch limit', () => {
    expect(
      KnowledgeAddItemsPayloadSchema.safeParse(createAddItemsPayload(KNOWLEDGE_RUNTIME_ITEMS_MAX + 1)).success
    ).toBe(false)
  })

  it('rejects note content above the runtime note content limit', () => {
    expect(
      KnowledgeAddItemsPayloadSchema.safeParse({
        baseId: 'base-1',
        items: [
          {
            type: 'note',
            data: { source: 'note-1', content: 'a'.repeat(KNOWLEDGE_NOTE_CONTENT_MAX + 1) }
          }
        ]
      }).success
    ).toBe(false)
  })

  it('rejects blank group owner ids', () => {
    expect(
      KnowledgeAddItemsPayloadSchema.safeParse({
        baseId: 'base-1',
        items: [{ type: 'note', groupId: '   ', data: { source: 'note-1', content: 'note' } }]
      }).success
    ).toBe(false)
  })
})

describe('KnowledgeItemsPayloadSchema', () => {
  it('accepts one item id', () => {
    expect(KnowledgeItemsPayloadSchema.safeParse(createPayload(1)).success).toBe(true)
  })

  it('accepts item ids at the runtime batch limit', () => {
    expect(KnowledgeItemsPayloadSchema.safeParse(createPayload(KNOWLEDGE_RUNTIME_ITEMS_MAX)).success).toBe(true)
  })

  it('rejects empty item id lists', () => {
    expect(KnowledgeItemsPayloadSchema.safeParse(createPayload(0)).success).toBe(false)
  })

  it('rejects item ids above the runtime batch limit', () => {
    expect(KnowledgeItemsPayloadSchema.safeParse(createPayload(KNOWLEDGE_RUNTIME_ITEMS_MAX + 1)).success).toBe(false)
  })
})

describe('KnowledgeSearchPayloadSchema', () => {
  it('accepts queries at the runtime query length limit', () => {
    expect(
      KnowledgeSearchPayloadSchema.safeParse({
        baseId: 'base-1',
        query: 'a'.repeat(1000)
      }).success
    ).toBe(true)
  })

  it('rejects queries above the runtime query length limit', () => {
    expect(
      KnowledgeSearchPayloadSchema.safeParse({
        baseId: 'base-1',
        query: 'a'.repeat(1001)
      }).success
    ).toBe(false)
  })
})
