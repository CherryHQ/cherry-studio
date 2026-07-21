import type { Assistant } from '@shared/data/types/assistant'
import { createUniqueModelId, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { getAnthropicReasoningParamsForEffort, getXAIReasoningParams } from '../reasoning'

describe('getAnthropicReasoningParamsForEffort', () => {
  const claude46Model = {
    id: createUniqueModelId('anthropic', 'claude-opus-4-6'),
    providerId: 'anthropic',
    apiModelId: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    capabilities: [MODEL_CAPABILITY.REASONING],
    reasoning: { supportedEfforts: ['low', 'medium', 'high', 'max'] }
  } as Model

  it('keeps the existing Assistant fallback strategy when mapping Agent effort', () => {
    expect(getAnthropicReasoningParamsForEffort('xhigh', claude46Model)).toEqual({
      thinking: { type: 'enabled', budgetTokens: expect.any(Number) },
      sendReasoning: true
    })
    expect(getAnthropicReasoningParamsForEffort('none', claude46Model)).toEqual({
      thinking: { type: 'disabled' }
    })
  })
})

describe('getXAIReasoningParams', () => {
  const grok43Model = {
    id: createUniqueModelId('xai', 'grok-4.3'),
    providerId: 'xai',
    apiModelId: 'grok-4.3',
    name: 'grok-4.3'
  } as Model

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
})
