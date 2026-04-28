import { CreatePinSchema } from '@shared/data/api/schemas/pins'
import { EntityIdSchema, EntityTypeSchema } from '@shared/data/types/entityType'
import { PinSchema } from '@shared/data/types/pin'
import { describe, expect, it } from 'vitest'

const PIN_BASE = {
  id: '11111111-1111-4111-8111-111111111111',
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const UUID_ENTITY_ID = '22222222-2222-4222-8222-222222222222'
const MODEL_ENTITY_ID = 'openai::gpt-4o'

describe('pin schemas', () => {
  it('includes model in the shared entity type vocabulary', () => {
    expect(EntityTypeSchema.safeParse('model').success).toBe(true)
    expect(EntityTypeSchema.safeParse('agent').success).toBe(false)
  })

  it('accepts both UUID and UniqueModelId through the shared entity id schema', () => {
    expect(EntityIdSchema.safeParse(UUID_ENTITY_ID).success).toBe(true)
    expect(EntityIdSchema.safeParse(MODEL_ENTITY_ID).success).toBe(true)
    expect(EntityIdSchema.safeParse('not-a-valid-entity-id').success).toBe(false)
  })

  it('uses a flat pin schema over the shared entity type and id schemas', () => {
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'model', entityId: MODEL_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'assistant', entityId: UUID_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'assistant', entityId: MODEL_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'agent', entityId: UUID_ENTITY_ID }).success).toBe(false)
  })

  it('derives create-pin input from the shared flat entity reference', () => {
    expect(CreatePinSchema.safeParse({ entityType: 'model', entityId: MODEL_ENTITY_ID }).success).toBe(true)
    expect(CreatePinSchema.safeParse({ entityType: 'topic', entityId: UUID_ENTITY_ID }).success).toBe(true)
    expect(CreatePinSchema.safeParse({ entityType: 'topic', entityId: MODEL_ENTITY_ID }).success).toBe(true)
  })
})
