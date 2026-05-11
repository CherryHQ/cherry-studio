import { KNOWLEDGE_NOTE_CONTENT_MAX, KNOWLEDGE_RUNTIME_ITEMS_MAX } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import {
  KnowledgeRuntimeAddItemsPayloadSchema,
  KnowledgeRuntimeBasePayloadSchema,
  KnowledgeRuntimeCreateBasePayloadSchema,
  KnowledgeRuntimeDeleteItemChunkPayloadSchema,
  KnowledgeRuntimeItemChunksPayloadSchema,
  KnowledgeRuntimeItemsPayloadSchema,
  KnowledgeRuntimeRestoreBasePayloadSchema,
  KnowledgeRuntimeSearchPayloadSchema
} from '../ipc'

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
      { name: 'create base', schema: KnowledgeRuntimeCreateBasePayloadSchema, payload: { base: createBaseInput() } },
      {
        name: 'restore base',
        schema: KnowledgeRuntimeRestoreBasePayloadSchema,
        payload: {
          sourceBaseId: 'base-1',
          name: 'Base 1_bak',
          dimensions: 3072,
          embeddingModelId: 'openai::text-embedding-3-large'
        }
      },
      { name: 'base', schema: KnowledgeRuntimeBasePayloadSchema, payload: { baseId: 'base-1' } },
      { name: 'add items', schema: KnowledgeRuntimeAddItemsPayloadSchema, payload: createAddItemsPayload(1) },
      { name: 'items', schema: KnowledgeRuntimeItemsPayloadSchema, payload: createPayload(1) },
      { name: 'search', schema: KnowledgeRuntimeSearchPayloadSchema, payload: { baseId: 'base-1', query: 'hello' } },
      {
        name: 'item chunks',
        schema: KnowledgeRuntimeItemChunksPayloadSchema,
        payload: { baseId: 'base-1', itemId: 'item-1' }
      },
      {
        name: 'delete item chunk',
        schema: KnowledgeRuntimeDeleteItemChunkPayloadSchema,
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
        schema: KnowledgeRuntimeCreateBasePayloadSchema,
        payload: { base: { ...createBaseInput(), name: '' } }
      },
      {
        name: 'restore base',
        schema: KnowledgeRuntimeRestoreBasePayloadSchema,
        payload: { sourceBaseId: 'base-1', dimensions: 3072, embeddingModelId: '', chunkOverlap: 120 }
      },
      { name: 'base', schema: KnowledgeRuntimeBasePayloadSchema, payload: { baseId: '' } },
      { name: 'add items', schema: KnowledgeRuntimeAddItemsPayloadSchema, payload: createAddItemsPayload(0) },
      { name: 'items', schema: KnowledgeRuntimeItemsPayloadSchema, payload: createPayload(0) },
      { name: 'search', schema: KnowledgeRuntimeSearchPayloadSchema, payload: { baseId: 'base-1', query: '' } },
      {
        name: 'item chunks',
        schema: KnowledgeRuntimeItemChunksPayloadSchema,
        payload: { baseId: 'base-1', itemId: '' }
      },
      {
        name: 'delete item chunk',
        schema: KnowledgeRuntimeDeleteItemChunkPayloadSchema,
        payload: { baseId: 'base-1', itemId: 'item-1', chunkId: '' }
      }
    ]

    for (const { name, payload, schema } of cases) {
      expect(schema.safeParse(payload).success, name).toBe(false)
    }
  })
})

describe('KnowledgeRuntimeAddItemsPayloadSchema', () => {
  it('accepts one runtime item', () => {
    expect(KnowledgeRuntimeAddItemsPayloadSchema.safeParse(createAddItemsPayload(1)).success).toBe(true)
  })

  it('accepts runtime items at the runtime batch limit', () => {
    expect(
      KnowledgeRuntimeAddItemsPayloadSchema.safeParse(createAddItemsPayload(KNOWLEDGE_RUNTIME_ITEMS_MAX)).success
    ).toBe(true)
  })

  it('rejects empty runtime item lists', () => {
    expect(KnowledgeRuntimeAddItemsPayloadSchema.safeParse(createAddItemsPayload(0)).success).toBe(false)
  })

  it('rejects runtime items above the runtime batch limit', () => {
    expect(
      KnowledgeRuntimeAddItemsPayloadSchema.safeParse(createAddItemsPayload(KNOWLEDGE_RUNTIME_ITEMS_MAX + 1)).success
    ).toBe(false)
  })

  it('rejects note content above the runtime note content limit', () => {
    expect(
      KnowledgeRuntimeAddItemsPayloadSchema.safeParse({
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
      KnowledgeRuntimeAddItemsPayloadSchema.safeParse({
        baseId: 'base-1',
        items: [{ type: 'note', groupId: '   ', data: { source: 'note-1', content: 'note' } }]
      }).success
    ).toBe(false)
  })
})

describe('KnowledgeRuntimeItemsPayloadSchema', () => {
  it('accepts one item id', () => {
    expect(KnowledgeRuntimeItemsPayloadSchema.safeParse(createPayload(1)).success).toBe(true)
  })

  it('accepts item ids at the runtime batch limit', () => {
    expect(KnowledgeRuntimeItemsPayloadSchema.safeParse(createPayload(KNOWLEDGE_RUNTIME_ITEMS_MAX)).success).toBe(true)
  })

  it('rejects empty item id lists', () => {
    expect(KnowledgeRuntimeItemsPayloadSchema.safeParse(createPayload(0)).success).toBe(false)
  })

  it('rejects item ids above the runtime batch limit', () => {
    expect(KnowledgeRuntimeItemsPayloadSchema.safeParse(createPayload(KNOWLEDGE_RUNTIME_ITEMS_MAX + 1)).success).toBe(
      false
    )
  })
})

describe('KnowledgeRuntimeSearchPayloadSchema', () => {
  it('accepts queries at the runtime query length limit', () => {
    expect(
      KnowledgeRuntimeSearchPayloadSchema.safeParse({
        baseId: 'base-1',
        query: 'a'.repeat(1000)
      }).success
    ).toBe(true)
  })

  it('rejects queries above the runtime query length limit', () => {
    expect(
      KnowledgeRuntimeSearchPayloadSchema.safeParse({
        baseId: 'base-1',
        query: 'a'.repeat(1001)
      }).success
    ).toBe(false)
  })
})
