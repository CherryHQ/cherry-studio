import type { Assistant } from '@shared/data/types/assistant'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { getReasoningEffort, getXAIReasoningParams } from '../reasoning'

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

describe('getReasoningEffort', () => {
  it('disables thinking explicitly for MiniMax M3', () => {
    const assistant = {
      settings: {
        reasoning_effort: 'none'
      }
    } as Assistant
    const model = {
      id: createUniqueModelId('minimax', 'minimax-m3'),
      providerId: 'minimax',
      apiModelId: 'MiniMax-M3',
      name: 'MiniMax M3',
      capabilities: ['reasoning']
    } as Model
    const provider = { id: 'minimax', name: 'MiniMax' } as Provider

    expect(getReasoningEffort(assistant, model, provider)).toEqual({ thinking: { type: 'disabled' } })
  })

  it('uses the declared none effort for GLM models with fixed effort levels', () => {
    const assistant = {
      settings: {
        reasoning_effort: 'none'
      }
    } as Assistant
    const model = {
      id: createUniqueModelId('provider-1', 'glm-5-2'),
      providerId: 'provider-1',
      apiModelId: 'glm-5.2',
      name: 'GLM-5.2',
      capabilities: ['reasoning'],
      reasoning: {
        type: 'openai-chat-completions',
        supportedEfforts: ['none', 'high', 'max', 'auto']
      }
    } as Model
    const provider = { id: 'provider-1', name: 'Provider' } as Provider

    expect(getReasoningEffort(assistant, model, provider)).toEqual({ reasoningEffort: 'none' })
  })
})
