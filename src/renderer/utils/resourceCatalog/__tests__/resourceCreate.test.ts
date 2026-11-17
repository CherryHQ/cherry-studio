import { describe, expect, it } from 'vitest'

import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'

import { buildCreateAgentCommand, buildCreateAssistantDto } from '../resourceCreate'

const values: ResourceCreateValues = {
  agentType: 'claude-code',
  permissionMode: 'auto',
  avatar: '🤖',
  name: 'Researcher',
  modelId: 'provider::model',
  description: 'Investigates a topic',
  prompt: 'Use cited sources',
  knowledgeBaseIds: ['kb-1'],
  skillIds: ['skill-1']
}

describe('resource create DTO mapping', () => {
  it('carries image bytes only in the Agent creation command, preserving its emoji fallback', () => {
    const avatarImage = new Uint8Array([1, 2, 3])
    expect(buildCreateAgentCommand({ ...values, avatarImage })).toMatchObject({
      avatarImage,
      configuration: { avatar: values.avatar }
    })
    expect(buildCreateAssistantDto({ ...values, avatarImage })).not.toHaveProperty('avatarImage')
  })
  it('maps every assistant-specific field', () => {
    expect(buildCreateAssistantDto(values)).toEqual({
      name: 'Researcher',
      emoji: '🤖',
      modelId: 'provider::model',
      description: 'Investigates a topic',
      prompt: 'Use cited sources',
      knowledgeBaseIds: ['kb-1']
    })
  })

  it('maps every agent-specific field', () => {
    expect(buildCreateAgentCommand(values)).toEqual({
      type: 'claude-code',
      name: 'Researcher',
      model: 'provider::model',
      planModel: 'provider::model',
      smallModel: 'provider::model',
      description: 'Investigates a topic',
      instructions: 'Use cited sources',
      knowledgeBaseIds: ['kb-1'],
      skillIds: ['skill-1'],
      configuration: {
        avatar: '🤖',
        permission_mode: 'auto'
      }
    })
  })

  it('uses pi runtime defaults and omits unsupported model tiers', () => {
    expect(buildCreateAgentCommand({ ...values, agentType: 'pi', permissionMode: 'acceptEdits' })).toEqual({
      type: 'pi',
      name: 'Researcher',
      model: 'provider::model',
      description: 'Investigates a topic',
      instructions: 'Use cited sources',
      knowledgeBaseIds: ['kb-1'],
      skillIds: ['skill-1'],
      configuration: { avatar: '🤖', permission_mode: 'acceptEdits' }
    })
  })
})
