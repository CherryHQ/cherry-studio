import type { Assistant } from '@shared/data/types/assistant'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { getAnthropicReasoningParams, getReasoningEffort, getXAIReasoningParams } from '../reasoning'

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

describe('MiniMax M3 thinking params', () => {
  // MiniMax only accepts thinking.type 'adaptive' | 'disabled'; 'enabled' is
  // rejected with a 400 (invalid thinking.type "enabled").
  const m3Model = {
    id: createUniqueModelId('minimax', 'MiniMax-M3'),
    providerId: 'minimax',
    apiModelId: 'MiniMax-M3',
    name: 'MiniMax-M3',
    capabilities: ['reasoning'],
    reasoning: {}
  } as unknown as Model
  const provider = { id: 'minimax', name: 'MiniMax' } as Provider

  it('OpenAI-compatible: thinking on → adaptive', () => {
    const assistant = { settings: { reasoning_effort: 'high' } } as Assistant
    expect(getReasoningEffort(assistant, m3Model, provider)).toEqual({ thinking: { type: 'adaptive' } })
  })

  it('OpenAI-compatible: thinking off → disabled', () => {
    const assistant = { settings: { reasoning_effort: 'none' } } as Assistant
    expect(getReasoningEffort(assistant, m3Model, provider)).toEqual({ thinking: { type: 'disabled' } })
  })

  it('Anthropic-compatible: thinking on → adaptive (not enabled)', () => {
    const assistant = { settings: { reasoning_effort: 'high' } } as Assistant
    expect(getAnthropicReasoningParams(assistant, m3Model)).toEqual({ thinking: { type: 'adaptive' } })
  })

  it('Anthropic-compatible: thinking off → disabled', () => {
    const assistant = { settings: { reasoning_effort: 'none' } } as Assistant
    expect(getAnthropicReasoningParams(assistant, m3Model)).toEqual({ thinking: { type: 'disabled' } })
  })
})
