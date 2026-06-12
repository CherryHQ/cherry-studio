import { describe, expect, it } from 'vitest'

import { AgentEntitySchema, CreateAgentSchema, ListAgentsQuerySchema, UpdateAgentSchema } from '../agents'

describe('AgentEntitySchema', () => {
  const baseAgent = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    type: 'claude-code',
    name: 'Agent',
    description: '',
    instructions: 'You are helpful.',
    model: 'openai::gpt-4',
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    modelName: null
  }

  it('requires service-populated modelName instead of defaulting it in Zod', () => {
    const { modelName, ...missingModelName } = baseAgent

    expect(AgentEntitySchema.safeParse(missingModelName).success).toBe(false)
    expect(AgentEntitySchema.parse(baseAgent).modelName).toBe(modelName)
  })

  it('does not expose outer user tags on agents', () => {
    expect(AgentEntitySchema.safeParse({ ...baseAgent, tags: [] }).success).toBe(false)
    expect(
      CreateAgentSchema.safeParse({ type: 'claude-code', name: 'Agent', model: 'model', tagIds: [] }).success
    ).toBe(false)
    expect(UpdateAgentSchema.safeParse({ tagIds: [] }).success).toBe(false)
    expect(ListAgentsQuerySchema.safeParse({ tagIds: ['11111111-1111-4111-8111-111111111111'] }).success).toBe(false)
  })

  it('deduplicates disabledTools at the API parse boundary', () => {
    expect(
      CreateAgentSchema.parse({
        type: 'claude-code',
        name: 'Agent',
        model: 'openai::gpt-4',
        disabledTools: ['Bash', 'Read', 'Bash']
      }).disabledTools
    ).toEqual(['Bash', 'Read'])
    expect(UpdateAgentSchema.parse({ disabledTools: ['Read', 'Read'] }).disabledTools).toEqual(['Read'])
  })
})
