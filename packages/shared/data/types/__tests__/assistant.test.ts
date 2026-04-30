import { describe, expect, it } from 'vitest'

import { AssistantIdSchema, DEFAULT_ASSISTANT_ID } from '../assistant'

describe('AssistantIdSchema', () => {
  it.each([
    DEFAULT_ASSISTANT_ID,
    '550e8400-e29b-41d4-a716-446655440000', // canonical UUID v4
    'a1b2c3d4-e5f6-4789-9abc-def012345678' // UUID v4 with valid variant bits
  ])('accepts %s', (id) => {
    expect(AssistantIdSchema.safeParse(id).success).toBe(true)
  })

  it.each([
    '',
    'arbitrary-text',
    '00000000-0000-0000-0000-000000000000', // nil UUID
    '550e8400-e29b-11d4-a716-446655440000', // UUID v1 shape (version=1)
    '550e8400-e29b-41d4-c716-446655440000', // v4 shape but invalid variant (c)
    'DEFAULT', // wrong case
    'Default'
  ])('rejects %s', (id) => {
    expect(AssistantIdSchema.safeParse(id).success).toBe(false)
  })
})
