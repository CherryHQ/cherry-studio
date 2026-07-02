import type { Assistant } from '@shared/data/types/assistant'
import { createUniqueModelId, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
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

describe('getReasoningEffort — Hunyuan hy3 (dual-protocol reasoning_effort)', () => {
  const hunyuanProvider = { id: 'hunyuan' } as Provider
  const hy3Model = {
    id: createUniqueModelId('hunyuan', 'hy3'),
    providerId: 'hunyuan',
    apiModelId: 'hy3',
    name: 'Hy3',
    capabilities: [MODEL_CAPABILITY.REASONING],
    reasoning: { type: 'openai-chat', supportedEfforts: ['none', 'high'] }
  } as Model

  const withEffort = (reasoning_effort: string) => ({ settings: { reasoning_effort } }) as Assistant

  it('disables thinking via reasoning_effort "none" (快思考)', () => {
    expect(getReasoningEffort(withEffort('none'), hy3Model, hunyuanProvider)).toEqual({ reasoningEffort: 'none' })
  })

  it('enables thinking via reasoning_effort "high" (慢思考)', () => {
    expect(getReasoningEffort(withEffort('high'), hy3Model, hunyuanProvider)).toEqual({ reasoningEffort: 'high' })
  })

  it('sends no reasoning param when effort is default', () => {
    expect(getReasoningEffort(withEffort('default'), hy3Model, hunyuanProvider)).toEqual({})
  })
})
