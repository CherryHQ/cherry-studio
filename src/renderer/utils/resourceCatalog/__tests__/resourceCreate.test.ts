import { describe, expect, it } from 'vitest'

import {
  resolveCatalogPresetModelId,
  isUniqueModelIdSelectable,
  toCreateAgentCommandFromCatalogPreset
} from '../resourceCreate'

describe('catalog preset creation', () => {
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
