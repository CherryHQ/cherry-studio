import { describe, expect, it } from 'vitest'

import { CHERRY_SUPPORT_AGENT_ID } from '@shared/ai/builtinAgent'
import { CreatePinSchema } from '@shared/data/api/schemas/pins'
import { EntityIdSchema, EntityTypeSchema } from '@shared/data/types/entityType'
import { PinSchema } from '@shared/data/types/pin'

const PIN_BASE = {
  id: '11111111-1111-4111-8111-111111111111',
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const UUID_ENTITY_ID = '22222222-2222-4222-8222-222222222222'
const MODEL_ENTITY_ID = 'openai::gpt-4o'
const AGENT_ENTITY_ID = '44444444-4444-4444-8444-444444444444'

describe('pin schemas', () => {
  it('includes model and agent in the shared entity type vocabulary', () => {
    expect(EntityTypeSchema.safeParse('model').success).toBe(true)
    expect(EntityTypeSchema.safeParse('agent').success).toBe(true)
  })

  it.each([
    UUID_ENTITY_ID,
    '22222222-2222-5222-8222-222222222222',
    '22222222-2222-7222-8222-222222222222',
    MODEL_ENTITY_ID,
    CHERRY_SUPPORT_AGENT_ID
  ])('accepts supported entity id %s', (entityId) => {
    expect(EntityIdSchema.safeParse(entityId).success).toBe(true)
  })

  it.each(['not-a-uuid', 'cherry-other', 'cherry-support-extra', ''])('rejects invalid entity id %s', (entityId) => {
    expect(EntityIdSchema.safeParse(entityId).success).toBe(false)
    expect(CreatePinSchema.safeParse({ entityType: 'agent', entityId }).success).toBe(false)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'agent', entityId }).success).toBe(false)
  })

  it('accepts the built-in support agent in both pin requests and responses', () => {
    const entity = { entityType: 'agent', entityId: CHERRY_SUPPORT_AGENT_ID }
    expect(CreatePinSchema.parse(entity)).toEqual(entity)
    expect(PinSchema.parse({ ...PIN_BASE, ...entity })).toEqual({ ...PIN_BASE, ...entity })
  })

  it('uses a flat pin schema over the shared entity type and id schemas', () => {
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'model', entityId: MODEL_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'agent', entityId: AGENT_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'assistant', entityId: UUID_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'assistant', entityId: MODEL_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'topic', entityId: AGENT_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'bot', entityId: UUID_ENTITY_ID }).success).toBe(false)
  })

  it('derives create-pin input from the shared flat entity reference', () => {
    expect(CreatePinSchema.safeParse({ entityType: 'model', entityId: MODEL_ENTITY_ID }).success).toBe(true)
    expect(CreatePinSchema.safeParse({ entityType: 'agent', entityId: AGENT_ENTITY_ID }).success).toBe(true)
    expect(CreatePinSchema.safeParse({ entityType: 'topic', entityId: UUID_ENTITY_ID }).success).toBe(true)
    expect(CreatePinSchema.safeParse({ entityType: 'topic', entityId: MODEL_ENTITY_ID }).success).toBe(true)
  })
})
