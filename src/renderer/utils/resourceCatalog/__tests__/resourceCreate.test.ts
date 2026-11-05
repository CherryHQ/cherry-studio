import { describe, expect, it } from 'vitest'

import type { ResourceCreateValues } from '@renderer/types/resourceCatalog'

import {
  buildCreateAgentCommand,
  buildCreateAssistantDto,
  resolveCatalogPresetModelId,
  isUniqueModelIdSelectable,
  toCreateAgentCommandFromCatalogPreset
} from '../resourceCreate'

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

  it('falls back to the runtime default when a stale mode is unsupported', () => {
    expect(
      buildCreateAgentCommand({ ...values, agentType: 'pi', permissionMode: 'plan' }).configuration?.permission_mode
    ).toBe('auto')
  })

  it('maps a catalog preset to a claude-code agent create command', () => {
    expect(
      toCreateAgentCommandFromCatalogPreset(
        {
          id: 'preset-1',
          name: ' Product Manager ',
          prompt: ' You are a PM. ',
          description: ' Plans work ',
          emoji: ' PM ',
          defaultModel: { id: 'gpt-4o', provider: 'openai' }
        },
        'fallback::model'
      )
    ).toEqual({
      type: 'claude-code',
      name: 'Product Manager',
      model: 'fallback::model',
      planModel: 'fallback::model',
      smallModel: 'fallback::model',
      description: 'Plans work',
      instructions: 'You are a PM.',
      configuration: { avatar: 'PM', permission_mode: 'auto' }
    })
  })

  it('prefers the preset default model over the chat default', () => {
    expect(
      resolveCatalogPresetModelId(
        { id: 'p', name: 'N', defaultModel: { id: 'sonnet', provider: 'anthropic' } },
        'openai::gpt-4o'
      )
    ).toBe('anthropic::sonnet')
    expect(resolveCatalogPresetModelId({ id: 'p', name: 'N' }, 'openai::gpt-4o')).toBe('openai::gpt-4o')
    expect(resolveCatalogPresetModelId({ id: 'p', name: 'N' }, null)).toBeNull()
  })

  it('falls back to the chat default when the preset model is not selectable', () => {
    const isSelectable = (modelId: string) => modelId === 'openai::gpt-4o'
    expect(
      resolveCatalogPresetModelId(
        { id: 'p', name: 'N', defaultModel: { id: 'sonnet', provider: 'anthropic' } },
        'openai::gpt-4o',
        isSelectable
      )
    ).toBe('openai::gpt-4o')
  })

  it('rejects disabled or missing models when validating selectability', () => {
    const model = {
      id: 'openai::gpt-4o' as const,
      providerId: 'openai',
      name: 'gpt-4o',
      capabilities: [],
      supportsStreaming: true,
      isHidden: false,
      isEnabled: false
    }
    expect(
      isUniqueModelIdSelectable('openai::gpt-4o', {
        models: [model],
        getProvider: () => ({ id: 'openai', isEnabled: true }) as any,
        isModelSelectable: () => true
      })
    ).toBe(false)
  })
})
