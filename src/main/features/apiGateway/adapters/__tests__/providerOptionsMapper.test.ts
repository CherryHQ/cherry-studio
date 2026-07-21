import { ENDPOINT_TYPE, type EndpointType, type Model, type RuntimeReasoning } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import {
  mapAnthropicThinkingToProviderOptions,
  mapGeminiThinkingToProviderOptions,
  mapReasoningEffortToProviderOptions
} from '../converters/providerOptionsMapper'

function provider(adapterFamily: string, endpointType: EndpointType): Provider {
  return {
    id: `target-${adapterFamily}`,
    endpointConfigs: { [endpointType]: { adapterFamily } }
  } as Provider
}

function model(providerId: string, modelId: string, endpointType: EndpointType, reasoning: RuntimeReasoning): Model {
  return {
    id: `${providerId}::${modelId}`,
    providerId,
    apiModelId: modelId,
    name: modelId,
    endpointTypes: [endpointType],
    capabilities: ['reasoning'],
    reasoning,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

const anthropicBudgetModel = model('anthropic', 'claude-3-7-sonnet', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, {
  type: 'anthropic',
  supportedEfforts: ['none', 'low', 'medium', 'high'],
  controls: [{ kind: 'budget', min: 1000, max: 11_000 }, { kind: 'toggle' }],
  thinkingTokenLimits: { min: 1000, max: 11_000 }
})

const openAIModel = model('openai', 'gpt-5', ENDPOINT_TYPE.OPENAI_RESPONSES, {
  type: 'openai-responses',
  supportedEfforts: ['none', 'low', 'medium', 'high'],
  controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }],
  thinkingTokenLimits: { min: 1000, max: 11_000 }
})

const geminiModel = model('google', 'gemini-2.5-flash', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, {
  type: 'gemini',
  supportedEfforts: ['none', 'low', 'medium', 'high', 'auto'],
  controls: [{ kind: 'budget', min: 0, max: 24_576 }, { kind: 'toggle' }],
  thinkingTokenLimits: { min: 0, max: 24_576 }
})

describe('same-dialect lossless pass-through', () => {
  it('keeps Anthropic thinking envelopes unchanged', () => {
    const target = provider('anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES)

    expect(
      mapAnthropicThinkingToProviderOptions(target, anthropicBudgetModel, {
        type: 'enabled',
        budget_tokens: 4096
      })
    ).toEqual({ anthropic: { thinking: { type: 'enabled', budgetTokens: 4096 } } })
    expect(mapAnthropicThinkingToProviderOptions(target, anthropicBudgetModel, { type: 'disabled' })).toEqual({
      anthropic: { thinking: { type: 'disabled' } }
    })
  })

  it.each([
    [{ thinkingBudget: -1 }, { thinkingBudget: -1 }],
    [{ thinkingBudget: 0 }, { thinkingBudget: 0 }],
    [{ includeThoughts: true }, { includeThoughts: true }],
    [{ thinkingLevel: 'high' }, { thinkingLevel: 'high' }],
    [
      { thinkingBudget: 512, includeThoughts: true },
      { thinkingBudget: 512, includeThoughts: true }
    ]
  ])('keeps Gemini thinkingConfig %# unchanged', (input, expected) => {
    const target = provider('google', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    expect(mapGeminiThinkingToProviderOptions(target, geminiModel, input)).toEqual({
      google: { thinkingConfig: expected }
    })
  })

  it('returns undefined for an empty Gemini thinkingConfig', () => {
    const target = provider('google', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    expect(mapGeminiThinkingToProviderOptions(target, geminiModel, {})).toBeUndefined()
  })

  it('recognizes a multiplexed gateway model whose active endpoint is Anthropic-native', () => {
    const target = provider('newapi', ENDPOINT_TYPE.ANTHROPIC_MESSAGES)

    expect(
      mapAnthropicThinkingToProviderOptions(target, anthropicBudgetModel, {
        type: 'enabled',
        budget_tokens: 4096
      })
    ).toEqual({ anthropic: { thinking: { type: 'enabled', budgetTokens: 4096 } } })
  })
})

describe('cross-dialect descriptor translation', () => {
  it('computes Anthropic budgets from descriptor limits instead of a fixed budget table', () => {
    const target = provider('anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES)

    expect(mapReasoningEffortToProviderOptions(target, anthropicBudgetModel, 'low')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 1500 } }
    })
    expect(mapReasoningEffortToProviderOptions(target, anthropicBudgetModel, 'high')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 9000 } }
    })
  })

  it('maps an Anthropic budget to the nearest target effort and disabled to off', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)

    expect(
      mapAnthropicThinkingToProviderOptions(target, openAIModel, { type: 'enabled', budget_tokens: 6000 })
    ).toEqual({ openai: { reasoningEffort: 'medium', reasoningSummary: undefined } })
    expect(mapAnthropicThinkingToProviderOptions(target, openAIModel, { type: 'disabled' })).toEqual({
      openai: { reasoningEffort: 'none', reasoningSummary: undefined }
    })
  })

  it('falls back to high when Anthropic budget translation has no descriptor limits', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)
    const modelWithoutLimits = {
      ...openAIModel,
      reasoning: { ...openAIModel.reasoning, thinkingTokenLimits: undefined }
    } as Model

    expect(
      mapAnthropicThinkingToProviderOptions(target, modelWithoutLimits, {
        type: 'enabled',
        budget_tokens: 1500
      })
    ).toEqual({ openai: { reasoningEffort: 'high', reasoningSummary: undefined } })
  })

  it('normalizes Gemini sentinels, levels, and positive budgets before target dispatch', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)

    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingBudget: -1 })).toEqual({
      openai: { reasoningEffort: 'medium', reasoningSummary: undefined }
    })
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingBudget: 0 })).toEqual({
      openai: { reasoningEffort: 'none', reasoningSummary: undefined }
    })
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingLevel: 'high' })).toEqual({
      openai: { reasoningEffort: 'high', reasoningSummary: undefined }
    })
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingBudget: 6000 })).toEqual({
      openai: { reasoningEffort: 'medium', reasoningSummary: undefined }
    })
  })

  it('uses the descriptor serializer for an OpenAI-compatible target', () => {
    const endpoint = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    const genericModel = model('relay', 'reasoner-v1', endpoint, {
      type: 'openrouter',
      supportedEfforts: ['none', 'low', 'medium', 'high'],
      controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }]
    })
    const target = provider('openai-compatible', endpoint)

    expect(mapReasoningEffortToProviderOptions(target, genericModel, 'medium')).toEqual({
      'openai-compatible': { reasoning: { effort: 'medium' } }
    })
    expect(mapReasoningEffortToProviderOptions(target, genericModel, 'none')).toEqual({
      'openai-compatible': { reasoning: { enabled: false, exclude: true } }
    })
  })

  it('returns undefined when the inbound format has no reasoning control', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)

    expect(mapReasoningEffortToProviderOptions(target, openAIModel, undefined)).toBeUndefined()
    expect(mapAnthropicThinkingToProviderOptions(target, openAIModel, undefined)).toBeUndefined()
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, {})).toBeUndefined()
  })
})
