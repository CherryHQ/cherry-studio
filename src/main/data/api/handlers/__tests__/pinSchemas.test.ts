import { PinSchema, PinTargetSchema, PinTargetTypeSchema } from '@shared/data/types/pin'
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
  it('binds model pins to UniqueModelId entity ids', () => {
    expect(PinTargetSchema.safeParse({ entityType: 'model', entityId: MODEL_ENTITY_ID }).success).toBe(true)
    expect(PinTargetSchema.safeParse({ entityType: 'model', entityId: UUID_ENTITY_ID }).success).toBe(false)
  })

  it('keeps non-model pins bound to UUID entity ids', () => {
    expect(PinTargetSchema.safeParse({ entityType: 'topic', entityId: UUID_ENTITY_ID }).success).toBe(true)
    expect(PinTargetSchema.safeParse({ entityType: 'topic', entityId: MODEL_ENTITY_ID }).success).toBe(false)
  })

  it('applies the same target binding to full pin rows', () => {
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'model', entityId: MODEL_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'model', entityId: UUID_ENTITY_ID }).success).toBe(false)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'assistant', entityId: UUID_ENTITY_ID }).success).toBe(true)
    expect(PinSchema.safeParse({ ...PIN_BASE, entityType: 'assistant', entityId: MODEL_ENTITY_ID }).success).toBe(false)
  })

  it('does not expose future agent pins before their lifecycle cleanup is implemented', () => {
    expect(PinTargetTypeSchema.safeParse('agent').success).toBe(false)
  })
})
