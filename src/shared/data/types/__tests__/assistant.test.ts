import { describe, expect, it } from 'vitest'

import { AssistantIdSchema, AssistantSchema, DEFAULT_ASSISTANT_SETTINGS } from '../assistant'

describe('AssistantIdSchema', () => {
  it.each([
    '550e8400-e29b-41d4-a716-446655440000', // canonical UUID v4
    'a1b2c3d4-e5f6-4789-9abc-def012345678' // UUID v4 with valid variant bits
  ])('accepts %s', (id) => {
    expect(AssistantIdSchema.safeParse(id).success).toBe(true)
  })

  it.each([
    'default',
    '',
    'arbitrary-text',
    '00000000-0000-0000-0000-000000000000', // nil UUID
    '550e8400-e29b-11d4-a716-446655440000', // UUID v1 shape (version=1)
    '550e8400-e29b-41d4-c716-446655440000', // v4 shape but invalid variant (c)
    'Default'
  ])('rejects %s', (id) => {
    expect(AssistantIdSchema.safeParse(id).success).toBe(false)
  })
})

describe('AssistantSchema', () => {
  const baseAssistant = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Assistant',
    prompt: '',
    emoji: '🌟',
    description: '',
    settings: DEFAULT_ASSISTANT_SETTINGS,
    modelId: null,
    mcpServerIds: [],
    knowledgeBaseIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    modelName: null
  }

  it('requires service-populated embedded fields instead of defaulting them in Zod', () => {
    const { tags, modelName, ...missingEmbeds } = baseAssistant

    expect(AssistantSchema.safeParse(missingEmbeds).success).toBe(false)
    expect(AssistantSchema.parse(baseAssistant)).toMatchObject({ tags, modelName })
  })
})
