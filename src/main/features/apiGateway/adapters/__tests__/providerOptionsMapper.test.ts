import { REASONING_FORMAT_PROFILES, type ReasoningWireProfile } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, type EndpointType, type Model, type RuntimeReasoning } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mapAnthropicThinkingToProviderOptions,
  mapGeminiThinkingToProviderOptions,
  mapReasoningEffortToProviderOptions
} from '../converters/providerOptionsMapper'

const mocks = vi.hoisted(() => ({
  resolveReasoningProfile: vi.fn()
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: { resolveReasoningProfile: mocks.resolveReasoningProfile }
}))

const anthropicBudgetWire: ReasoningWireProfile = {
  off: {
    operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }]
  },
  effort: {
    operations: [
      { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } },
      { target: 'thinking.budgetTokens', value: { source: 'budget' } },
      { target: 'sendReasoning', value: { source: 'literal', value: true } }
    ],
    budget: { missing: { type: 'fallback', value: 13_312 }, clampToMaxTokens: true }
  }
}

beforeEach(() => {
  mocks.resolveReasoningProfile.mockImplementation((_provider, _model, endpointType: EndpointType) => {
    switch (endpointType) {
      case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
        return { format: 'anthropic', wire: anthropicBudgetWire }
      case ENDPOINT_TYPE.OPENAI_RESPONSES:
        return { format: 'openai-responses', wire: REASONING_FORMAT_PROFILES['openai-responses'].wire }
      case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
        return { format: 'openai-chat', wire: REASONING_FORMAT_PROFILES['openai-chat'].wire }
      default:
        throw new Error(`Unexpected endpoint type: ${endpointType}`)
    }
  })
})

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
  selectableEfforts: ['none', 'low', 'medium', 'high'],
  controls: [{ kind: 'budget', min: 1000, max: 11_000 }, { kind: 'toggle' }],
  thinkingTokenLimits: { min: 1000, max: 11_000 }
})

const openAIModel = model('openai', 'gpt-5', ENDPOINT_TYPE.OPENAI_RESPONSES, {
  selectableEfforts: ['none', 'low', 'medium', 'high'],
  controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }],
  thinkingTokenLimits: { min: 1000, max: 11_000 }
})

const geminiModel = model('google', 'gemini-2.5-flash', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, {
  selectableEfforts: ['none', 'low', 'medium', 'high', 'auto'],
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
      anthropic: { thinking: { type: 'enabled', budgetTokens: 1500 }, sendReasoning: true }
    })
    expect(mapReasoningEffortToProviderOptions(target, anthropicBudgetModel, 'high')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 8191 }, sendReasoning: true }
    })
  })

  it('clamps a translated Anthropic budget below the request max output tokens', () => {
    const target = provider('anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES)

    expect(mapReasoningEffortToProviderOptions(target, anthropicBudgetModel, 'high', 2048)).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 2047 }, sendReasoning: true }
    })
  })

  it('maps an Anthropic budget to the nearest target effort and disabled to off', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)

    expect(
      mapAnthropicThinkingToProviderOptions(target, openAIModel, { type: 'enabled', budget_tokens: 6000 })
    ).toEqual({ openai: { reasoningEffort: 'medium' } })
    expect(mapAnthropicThinkingToProviderOptions(target, openAIModel, { type: 'disabled' })).toEqual({
      openai: { reasoningEffort: 'none' }
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
    ).toEqual({ openai: { reasoningEffort: 'high' } })
  })

  it('normalizes Gemini sentinels, levels, and positive budgets before target dispatch', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)

    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingBudget: -1 })).toEqual({
      openai: { reasoningEffort: 'medium' }
    })
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingBudget: 0 })).toEqual({
      openai: { reasoningEffort: 'none' }
    })
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingLevel: 'high' })).toEqual({
      openai: { reasoningEffort: 'high' }
    })
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingBudget: 6000 })).toEqual({
      openai: { reasoningEffort: 'medium' }
    })
  })

  it('uses the descriptor serializer for an OpenAI-compatible target', () => {
    const endpoint = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    const genericModel = model('relay', 'reasoner-v1', endpoint, {
      selectableEfforts: ['none', 'low', 'medium', 'high'],
      controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }]
    })
    const target = provider('openai-compatible', endpoint)

    expect(mapReasoningEffortToProviderOptions(target, genericModel, 'medium')).toEqual({
      'target-openai-compatible': { reasoningEffort: 'medium' }
    })
    expect(mapReasoningEffortToProviderOptions(target, genericModel, 'none')).toEqual({
      'target-openai-compatible': { reasoningEffort: 'none' }
    })
  })

  it('normalizes a snake_case effort from an exact NVIDIA Gateway contract', () => {
    const endpoint = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    const nvidia = {
      id: 'nvidia',
      endpointConfigs: { [endpoint]: { adapterFamily: 'openai-compatible' } }
    } as Provider
    const gptOss = model('nvidia', 'gpt-oss-120b', endpoint, {
      selectableEfforts: ['low', 'medium', 'high'],
      controls: [{ kind: 'effort', values: ['low', 'medium', 'high'], default: 'medium' }]
    })
    mocks.resolveReasoningProfile.mockReturnValueOnce({
      format: 'openai-chat',
      wire: {
        effort: {
          operations: [{ target: 'reasoning_effort', value: { source: 'effort' } }]
        }
      }
    })

    expect(mapReasoningEffortToProviderOptions(nvidia, gptOss, 'high')).toEqual({
      nvidia: { reasoningEffort: 'high' }
    })
  })

  it('returns undefined when the inbound format has no reasoning control', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)

    expect(mapReasoningEffortToProviderOptions(target, openAIModel, undefined)).toBeUndefined()
    expect(mapAnthropicThinkingToProviderOptions(target, openAIModel, undefined)).toBeUndefined()
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, {})).toBeUndefined()
  })
})
