import { KNOWLEDGE_RUNTIME_ITEMS_MAX } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { KnowledgeRuntimeItemsPayloadSchema } from '../ipc'

const createPayload = (count: number) => ({
  baseId: 'base-1',
  itemIds: Array.from({ length: count }, (_, index) => `item-${index}`)
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
