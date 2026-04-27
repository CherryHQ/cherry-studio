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
const AGENT_ENTITY_ID = 'agent_1700000000000_abc123xyz'

describe('pin schemas', () => {
  it('includes model and agent in the shared entity type vocabulary', () => {
    expect(EntityTypeSchema.safeParse('model').success).toBe(true)
    expect(EntityTypeSchema.safeParse('agent').success).toBe(true)
  })

  it('accepts UUID, UniqueModelId, and any non-empty agent id through the shared entity id schema', () => {
    expect(EntityIdSchema.safeParse(UUID_ENTITY_ID).success).toBe(true)
    expect(EntityIdSchema.safeParse(MODEL_ENTITY_ID).success).toBe(true)
    expect(EntityIdSchema.safeParse(AGENT_ENTITY_ID).success).toBe(true)
    expect(EntityIdSchema.safeParse('cherry-claw-default').success).toBe(true)
    // TODO(agent-uuid-migration): drop the legacy-id case and tighten the negative case below
    //   back to a non-UUID string (e.g. 'not-a-uuid') once upstream agent ids migrate to UUID.
    expect(EntityIdSchema.safeParse('legacy-agent-id-without-prefix').success).toBe(true)
    expect(EntityIdSchema.safeParse('').success).toBe(false)
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
