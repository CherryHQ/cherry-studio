import {
  type ProtoReasoningSupport,
  REASONING_FORMAT_PROFILES,
  type ReasoningWireProfile
} from '@cherrystudio/provider-registry'
import type * as ProviderRegistryServiceModule from '@data/services/ProviderRegistryService'
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

vi.mock('@data/services/ProviderRegistryService', async (importOriginal) => {
  const actual = await importOriginal<typeof ProviderRegistryServiceModule>()
  return {
    ...actual,
    providerRegistryService: { resolveReasoningProfile: mocks.resolveReasoningProfile }
  }
})

const anthropicBudgetWire: ReasoningWireProfile = {
  off: {
    operations: [
      { target: 'thinking.type', value: { source: 'literal', value: 'disabled' }, delivery: 'provider-option' as const }
    ]
  },
  effort: {
    operations: [
      { target: 'thinking.type', value: { source: 'literal', value: 'enabled' }, delivery: 'provider-option' as const },
      { target: 'thinking.budgetTokens', value: { source: 'budget' }, delivery: 'provider-option' as const },
      { target: 'sendReasoning', value: { source: 'literal', value: true }, delivery: 'provider-option' as const }
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
      case ENDPOINT_TYPE.OLLAMA_CHAT:
        return { format: 'ollama', wire: REASONING_FORMAT_PROFILES['ollama'].wire }
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

const registryReasoningSupportWithBudget: ProtoReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'xhigh'] }],
  thinkingTokenLimits: { min: 1000, max: 11_000 }
}

const geminiModel = model('google', 'gemini-2.5-flash', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, {
  selectableEfforts: ['none', 'low', 'medium', 'high', 'auto'],
  controls: [{ kind: 'budget', min: 0, max: 24_576 }, { kind: 'toggle' }],
  thinkingTokenLimits: { min: 0, max: 24_576 }
})

const ollamaModel = model('ollama', 'gemma3:1b', ENDPOINT_TYPE.OLLAMA_CHAT, {
  selectableEfforts: ['none', 'low', 'medium', 'high'],
  controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }]
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
  it.each(['none', 'high'] as const)(
    'projects registry reasoning support when the runtime model omits it for %s',
    (effort) => {
      const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)
      const modelWithoutRuntimeReasoning = {
        ...openAIModel,
        capabilities: [],
        reasoning: undefined
      } as Model
      const support: ProtoReasoningSupport = {
        controls: [{ kind: 'effort', values: ['none', 'high'] }]
      }
      mocks.resolveReasoningProfile.mockReturnValueOnce({
        format: 'openai-responses',
        support,
        wire: REASONING_FORMAT_PROFILES['openai-responses'].wire
      })

      expect(mapReasoningEffortToProviderOptions(target, modelWithoutRuntimeReasoning, effort)).toEqual({
        openai: { reasoningEffort: effort, forceReasoning: true }
      })
    }
  )

  it('does not force Responses reasoning when the registry cannot emit the selected effort', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)
    const modelWithoutRuntimeReasoning = {
      ...openAIModel,
      capabilities: [],
      reasoning: undefined
    } as Model
    mocks.resolveReasoningProfile.mockReturnValueOnce({
      format: 'openai-responses',
      support: { controls: [{ kind: 'effort', values: ['none'] }] },
      wire: REASONING_FORMAT_PROFILES['openai-responses'].wire
    })

    expect(mapReasoningEffortToProviderOptions(target, modelWithoutRuntimeReasoning, 'high')).toEqual({})
  })

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
    ).toEqual({ openai: { reasoningEffort: 'medium', forceReasoning: true } })
    expect(mapAnthropicThinkingToProviderOptions(target, openAIModel, { type: 'disabled' })).toEqual({
      openai: { reasoningEffort: 'none', forceReasoning: true }
    })
  })

  it('uses registry token limits when translating an Anthropic budget without runtime reasoning', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)
    const modelWithoutRuntimeReasoning = { ...openAIModel, capabilities: [], reasoning: undefined } as Model
    mocks.resolveReasoningProfile.mockReturnValueOnce({
      format: 'openai-responses',
      support: registryReasoningSupportWithBudget,
      wire: REASONING_FORMAT_PROFILES['openai-responses'].wire
    })

    expect(
      mapAnthropicThinkingToProviderOptions(target, modelWithoutRuntimeReasoning, {
        type: 'enabled',
        budget_tokens: 1500
      })
    ).toEqual({ openai: { reasoningEffort: 'low', forceReasoning: true } })
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
    ).toEqual({ openai: { reasoningEffort: 'high', forceReasoning: true } })
  })

  it('normalizes Gemini sentinels, levels, and positive budgets before target dispatch', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)

    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingBudget: -1 })).toEqual({
      openai: { reasoningEffort: 'medium', forceReasoning: true }
    })
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingBudget: 0 })).toEqual({
      openai: { reasoningEffort: 'none', forceReasoning: true }
    })
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingLevel: 'high' })).toEqual({
      openai: { reasoningEffort: 'high', forceReasoning: true }
    })
    expect(mapGeminiThinkingToProviderOptions(target, openAIModel, { thinkingBudget: 6000 })).toEqual({
      openai: { reasoningEffort: 'medium', forceReasoning: true }
    })
  })

  it('uses registry token limits when translating a Gemini budget without runtime reasoning', () => {
    const target = provider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES)
    const modelWithoutRuntimeReasoning = { ...openAIModel, capabilities: [], reasoning: undefined } as Model
    mocks.resolveReasoningProfile.mockReturnValueOnce({
      format: 'openai-responses',
      support: registryReasoningSupportWithBudget,
      wire: REASONING_FORMAT_PROFILES['openai-responses'].wire
    })

    expect(mapGeminiThinkingToProviderOptions(target, modelWithoutRuntimeReasoning, { thinkingBudget: 1500 })).toEqual({
      openai: { reasoningEffort: 'low', forceReasoning: true }
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

  it('routes API Gateway reasoning for a DMXAPI OpenAI-family model into the openai namespace', () => {
    const endpoint = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    const dmxapi = {
      id: 'dmxapi',
      defaultChatEndpoint: endpoint,
      endpointConfigs: { [endpoint]: { adapterFamily: 'dmxapi' } },
      settings: {}
    } as Provider
    const gpt5 = {
      ...model('dmxapi', 'gpt-5', endpoint, {
        selectableEfforts: ['none', 'low', 'medium', 'high'],
        controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }]
      }),
      endpointTypes: undefined
    } as Model

    expect(mapReasoningEffortToProviderOptions(dmxapi, gpt5, 'high')).toEqual({
      openai: { reasoningEffort: 'high' }
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

describe('ollama think guard (#18695)', () => {
  const ollamaTarget = provider('ollama', ENDPOINT_TYPE.OLLAMA_CHAT)

  it('returns undefined for SDK default adaptive (no explicit effort) — avoids think:true on non-thinking models', () => {
    expect(mapAnthropicThinkingToProviderOptions(ollamaTarget, ollamaModel, { type: 'adaptive' })).toBeUndefined()
  })

  it('returns undefined when no config and no effort (SDK sent nothing)', () => {
    expect(mapAnthropicThinkingToProviderOptions(ollamaTarget, ollamaModel, undefined)).toBeUndefined()
  })

  it('emits think:false when user explicitly disabled thinking', () => {
    expect(mapAnthropicThinkingToProviderOptions(ollamaTarget, ollamaModel, { type: 'disabled' })).toEqual({
      ollama: { think: false }
    })
  })

  it('emits think when user explicitly set an effort level', () => {
    expect(mapAnthropicThinkingToProviderOptions(ollamaTarget, ollamaModel, undefined, 'high')).toEqual({
      ollama: { think: 'high' }
    })
  })

  it('emits think when user explicitly enabled thinking with budget', () => {
    expect(
      mapAnthropicThinkingToProviderOptions(ollamaTarget, ollamaModel, { type: 'enabled', budget_tokens: 4096 })
    ).toEqual({
      ollama: { think: 'high' }
    })
  })
})
