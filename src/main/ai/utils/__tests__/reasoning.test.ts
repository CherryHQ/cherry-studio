import type { Assistant } from '@shared/data/types/assistant'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { getXAIReasoningParams } from '../reasoning'

describe('getXAIReasoningParams', () => {
  // Descriptor-driven (#16598): the vocabulary comes from the xai creator's
  // family rule, mirrored here as the model's effort control.
  const grok43Model = {
    id: createUniqueModelId('xai', 'grok-4.3'),
    providerId: 'xai',
    apiModelId: 'grok-4.3',
    name: 'grok-4.3',
    capabilities: ['reasoning'],
    reasoning: {
      type: '',
      supportedEfforts: [],
      controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }]
    }
  } as unknown as Model

  it('sends none for Grok 4.3 (reasoning disabled — the xAI enum supports it, added by #15137)', () => {
    const assistant = {
      settings: {
        reasoning_effort: 'none'
      }
    } as Assistant

    expect(getXAIReasoningParams(assistant, grok43Model)).toEqual({ reasoningEffort: 'none' })
  })

  it('keeps supported Grok 4.3 reasoning efforts', () => {
    const assistant = {
      settings: {
        reasoning_effort: 'high'
      }
    } as Assistant

    expect(getXAIReasoningParams(assistant, grok43Model)).toEqual({ reasoningEffort: 'high' })
  })

  it('coerces stale tiers to the nearest declared one and ignores non-grok models', () => {
    const grok3Mini = {
      ...grok43Model,
      id: createUniqueModelId('xai', 'grok-3-mini'),
      apiModelId: 'grok-3-mini',
      reasoning: { type: '', supportedEfforts: [], controls: [{ kind: 'effort', values: ['low', 'high'] }] }
    } as unknown as Model
    expect(getXAIReasoningParams({ settings: { reasoning_effort: 'xhigh' } } as Assistant, grok3Mini)).toEqual({
      reasoningEffort: 'high'
    })

    const notGrok = { ...grok43Model, id: createUniqueModelId('xai', 'gpt-5'), apiModelId: 'gpt-5' } as unknown as Model
    expect(getXAIReasoningParams({ settings: { reasoning_effort: 'high' } } as Assistant, notGrok)).toEqual({})
  })
})
