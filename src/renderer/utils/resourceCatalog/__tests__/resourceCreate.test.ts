import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'
import { describe, expect, it } from 'vitest'

import { buildCreateAgentDto, buildCreateAssistantDto } from '../resourceCreate'

const values: ResourceCreateValues = {
  avatar: '🤖',
  name: 'Researcher',
  modelId: 'provider::model',
  description: 'Investigates a topic',
  prompt: 'Use cited sources',
  knowledgeBaseIds: ['kb-1'],
  skillIds: ['skill-1']
}

describe('resource create DTO mapping', () => {
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
    expect(buildCreateAgentDto(values, 'claude-code')).toEqual({
      type: 'claude-code',
      name: 'Researcher',
      model: 'provider::model',
      planModel: 'provider::model',
      smallModel: 'provider::model',
      description: 'Investigates a topic',
      instructions: 'Use cited sources',
      skillIds: ['skill-1'],
      configuration: {
        avatar: '🤖',
        permission_mode: 'bypassPermissions'
      }
    })
  })

  it('uses Pi runtime defaults instead of Claude-only model tiers', () => {
    expect(buildCreateAgentDto(values, 'pi')).toEqual({
      type: 'pi',
      name: 'Researcher',
      model: 'provider::model',
      description: 'Investigates a topic',
      instructions: 'Use cited sources',
      skillIds: ['skill-1'],
      configuration: {
        avatar: '🤖',
        permission_mode: 'default'
      }
    })
  })
})
