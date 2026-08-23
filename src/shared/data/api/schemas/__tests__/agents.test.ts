import { describe, expect, it } from 'vitest'

import {
  AGENT_LANGUAGE_MAX_LENGTH,
  AgentConfigurationSchema,
  AgentEntitySchema,
  ListAgentsQuerySchema,
  UpdateAgentSchema
} from '../agents'

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
    expect(UpdateAgentSchema.safeParse({ tagIds: [] }).success).toBe(false)
    expect(ListAgentsQuerySchema.safeParse({ tagIds: ['11111111-1111-4111-8111-111111111111'] }).success).toBe(false)
  })

  it('deduplicates disabledTools at the API parse boundary', () => {
    expect(UpdateAgentSchema.parse({ disabledTools: ['Read', 'Read'] }).disabledTools).toEqual(['Read'])
  })

  it('does not accept create-only skillIds on update', () => {
    expect(UpdateAgentSchema.safeParse({ skillIds: ['skill-b'] }).success).toBe(false)
  })

  it('validates the persisted agent reasoning effort', () => {
    expect(AgentConfigurationSchema.parse({ reasoning_effort: 'high' }).reasoning_effort).toBe('high')
    expect(AgentConfigurationSchema.safeParse({ reasoning_effort: 'invalid' }).success).toBe(false)
  })

  it('validates the persisted agent service tier', () => {
    expect(AgentConfigurationSchema.parse({ service_tier: 'fast' }).service_tier).toBe('fast')
    expect(AgentConfigurationSchema.safeParse({ service_tier: 'invalid' }).success).toBe(false)
  })

  it('bounds the per-agent language label: trimmed, nullable, length-capped', () => {
    expect(AgentConfigurationSchema.parse({ language: '  Thai  ' }).language).toBe('Thai')
    expect(AgentConfigurationSchema.parse({ language: null }).language).toBeNull()
    expect(AgentConfigurationSchema.parse({ language: undefined }).language).toBeUndefined()
    expect(AgentConfigurationSchema.parse({ language: 'x'.repeat(AGENT_LANGUAGE_MAX_LENGTH) }).language).toHaveLength(
      AGENT_LANGUAGE_MAX_LENGTH
    )
    expect(AgentConfigurationSchema.safeParse({ language: 'x'.repeat(AGENT_LANGUAGE_MAX_LENGTH + 1) }).success).toBe(
      false
    )
  })

  it('accepts first-level configuration patches and preserves explicit removals', () => {
    expect(UpdateAgentSchema.parse({ configuration: { reasoning_effort: 'high' } }).configuration).toEqual({
      reasoning_effort: 'high'
    })

    const parsed = UpdateAgentSchema.parse({ configuration: { reasoning_effort: undefined } })
    expect(parsed.configuration).toHaveProperty('reasoning_effort', undefined)
  })

  it('validates and deduplicates knowledgeBaseIds at the API parse boundary', () => {
    expect(UpdateAgentSchema.parse({ knowledgeBaseIds: ['kb-b', 'kb-b'] }).knowledgeBaseIds).toEqual(['kb-b'])
    expect(UpdateAgentSchema.parse({ knowledgeBaseIds: [] }).knowledgeBaseIds).toEqual([])
    expect(UpdateAgentSchema.safeParse({ knowledgeBaseIds: [''] }).success).toBe(false)
  })

  it('deduplicates update skillUpdates at the API parse boundary', () => {
    expect(
      UpdateAgentSchema.parse({
        skillUpdates: [
          { skillId: 'skill-a', isEnabled: true },
          { skillId: 'skill-b', isEnabled: true },
          { skillId: 'skill-a', isEnabled: false }
        ]
      }).skillUpdates
    ).toEqual([
      { skillId: 'skill-a', isEnabled: false },
      { skillId: 'skill-b', isEnabled: true }
    ])
  })
})
