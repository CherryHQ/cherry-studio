import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { buildCapabilityProviderOptions, extractAiSdkStandardParams, mergeCustomProviderParameters } from '../options'

describe('extractAiSdkStandardParams', () => {
  it('routes AI-SDK standard params to standardParams, others to providerParams', () => {
    const input = {
      topK: 40,
      frequencyPenalty: 0.5,
      stopSequences: ['END'],
      seed: 42,
      reasoningEffort: 'high',
      customFlag: true
    }
    const { standardParams, providerParams } = extractAiSdkStandardParams(input)
    expect(standardParams).toEqual({
      topK: 40,
      frequencyPenalty: 0.5,
      stopSequences: ['END'],
      seed: 42
    })
    expect(providerParams).toEqual({
      reasoningEffort: 'high',
      customFlag: true
    })
  })

  it('returns empty maps for empty input', () => {
    const { standardParams, providerParams } = extractAiSdkStandardParams({})
    expect(standardParams).toEqual({})
    expect(providerParams).toEqual({})
  })

  it('treats unknown keys as provider params (forward-compat)', () => {
    const { standardParams, providerParams } = extractAiSdkStandardParams({ futureField: 'xyz' })
    expect(standardParams).toEqual({})
    expect(providerParams).toEqual({ futureField: 'xyz' })
  })
})

describe('mergeCustomProviderParameters', () => {
  it('Case 1: key in actualAiSdkProviderIds → merge directly', () => {
    const initial = { openai: { reasoningEffort: 'low' as never } }
    const result = mergeCustomProviderParameters(
      initial as Record<string, Record<string, never>>,
      { openai: { customFlag: true } },
      'openai'
    )
    expect(result).toEqual({
      openai: { reasoningEffort: 'low', customFlag: true }
    })
  })

  it('Case 2 (proxy): key === rawProviderId, not in actualAiSdkProviderIds → map to primary', () => {
    // CherryIn proxy emits `google` as the actual SDK provider; user writes `cherryin: {...}`.
    const initial = { google: {} }
    const result = mergeCustomProviderParameters(
      initial as Record<string, Record<string, never>>,
      { cherryin: { proxyOpt: 'val' } },
      'cherryin'
    )
    expect(result).toEqual({ google: { proxyOpt: 'val' } })
  })

  it('Case 2 (gateway): preserves gateway key for routing', () => {
    const initial = { gateway: {} }
    const result = mergeCustomProviderParameters(
      initial as Record<string, Record<string, never>>,
      { gateway: { order: ['openai', 'anthropic'] } },
      'gateway'
    )
    expect(result).toEqual({ gateway: { order: ['openai', 'anthropic'] } })
  })

  it('Case 3: regular params merged onto primary provider', () => {
    const initial = { google: {} }
    const result = mergeCustomProviderParameters(
      initial as Record<string, Record<string, never>>,
      { customKey: 'customVal' },
      'google'
    )
    expect(result).toEqual({ google: { customKey: 'customVal' } })
  })

  it('renames `reasoning_effort` → `reasoningEffort` for openai-compatible providers', () => {
    const initial = { 'openai-compatible': {} }
    const result = mergeCustomProviderParameters(
      initial as Record<string, Record<string, never>>,
      { reasoning_effort: 'high' },
      'openai-compatible'
    )
    // The key should be renamed and applied to the primary (openai-compatible) provider.
    expect(result).toEqual({
      'openai-compatible': { reasoningEffort: 'high' }
    })
  })

  it('does NOT clobber existing reasoningEffort with renamed reasoning_effort', () => {
    const initial = { 'openai-compatible': {} }
    const result = mergeCustomProviderParameters(
      initial as Record<string, Record<string, never>>,
      { reasoning_effort: 'high', reasoningEffort: 'low' },
      'openai-compatible'
    )
    // Existing reasoningEffort wins; reasoning_effort dropped.
    expect((result['openai-compatible'] as Record<string, unknown>).reasoningEffort).toBe('low')
  })

  it('normalizes reasoning_effort into a concrete provider namespace for an openai-compatible adapter', () => {
    const result = mergeCustomProviderParameters(
      { dashscope: {} } as Record<string, Record<string, never>>,
      { dashscope: { reasoning_effort: 'high' } },
      'dashscope',
      'openai-compatible'
    )

    expect(result).toEqual({ dashscope: { reasoningEffort: 'high' } })
  })

  it('does not rewrite a nested extra_body reasoning_effort field', () => {
    const result = mergeCustomProviderParameters(
      { poe: {} } as Record<string, Record<string, never>>,
      { extra_body: { reasoning_effort: 'high' } },
      'poe',
      'openai-compatible'
    )

    expect(result).toEqual({ poe: { extra_body: { reasoning_effort: 'high' } } })
  })

  it('preserves unrelated providerOptions entries', () => {
    const initial = { google: { thinkingConfig: { mode: 'auto' as never } }, anthropic: { cacheControl: {} as never } }
    const result = mergeCustomProviderParameters(
      initial as unknown as Record<string, Record<string, never>>,
      { google: { extra: 1 } },
      'google'
    )
    expect(result.anthropic).toEqual({ cacheControl: {} })
    expect(result.google).toMatchObject({ thinkingConfig: { mode: 'auto' }, extra: 1 })
  })
})

describe('customParameters → providerOptions plugin contract', () => {
  // Smoke test: verifies the renderer's spec — when an assistant defines
  // `topK: 40` and `customFlag: true`, after a full plugin run the params
  // should have `topK: 40` at the root and `providerOptions.openai.customFlag`.
  it('splits standardParams to root and providerParams to providerOptions[primaryId]', () => {
    const flat = { topK: 40, customFlag: true }
    const { standardParams, providerParams } = extractAiSdkStandardParams(flat)
    const providerOptions = mergeCustomProviderParameters(
      { openai: {} } as Record<string, Record<string, never>>,
      providerParams,
      'openai'
    )
    expect(standardParams).toEqual({ topK: 40 })
    expect(providerOptions).toEqual({ openai: { customFlag: true } })
  })
})

describe('buildCapabilityProviderOptions', () => {
  it('places resolved OpenAI reasoning emissions in the native namespace', () => {
    const assistant = {
      settings: {
        reasoning_effort: 'medium'
      }
    } as Assistant
    const model = {
      id: 'openai::gpt-5',
      providerId: 'openai',
      name: 'gpt-5',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
        selectableEfforts: ['low', 'medium', 'high']
      }
    } as unknown as Model
    const provider = {
      id: 'openai',
      name: 'OpenAI',
      apiFeatures: {
        arrayContent: true,
        streamOptions: true,
        developerRole: false,
        serviceTier: false,
        verbosity: false,
        enableThinking: true
      },
      apiKeys: [],
      authType: 'api-key',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'openai' }
      },
      settings: {
        summaryText: 'detailed'
      },
      isEnabled: true
    } as Provider

    const result = buildCapabilityProviderOptions(
      assistant,
      model,
      provider,
      {
        enableReasoning: true,
        enableWebSearch: false,
        enableGenerateImage: false
      },
      {
        aiSdkProviderId: 'openai',
        runtimeProviderId: 'openai',
        endpointType: ENDPOINT_TYPE.OPENAI_RESPONSES,
        reasoning: {
          kind: 'effort',
          selection: 'medium',
          effort: 'medium',
          emissions: [
            { target: 'reasoningEffort', value: 'medium' },
            { target: 'reasoningSummary', value: 'detailed' }
          ]
        }
      }
    )

    expect(result.openai.reasoningSummary).toBe('detailed')
    expect(result.openai.store).toBe(false)
  })

  it('places compatible wire fields in the concrete provider namespace', () => {
    const result = buildCapabilityProviderOptions(
      { settings: { reasoning_effort: 'auto' } } as Assistant,
      {
        id: 'minimax::minimax-m3',
        providerId: 'minimax',
        name: 'MiniMax-M3',
        capabilities: [MODEL_CAPABILITY.REASONING],
        reasoning: {
          controls: [{ kind: 'toggle' }],
          selectableEfforts: ['none', 'auto']
        }
      } as unknown as Model,
      { id: 'minimax', name: 'MiniMax', settings: {} } as Provider,
      {
        enableReasoning: true,
        enableWebSearch: false,
        enableGenerateImage: false
      },
      {
        aiSdkProviderId: 'openai-compatible',
        runtimeProviderId: 'openai-compatible',
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        reasoning: {
          kind: 'auto',
          selection: 'auto',
          emissions: [{ target: 'thinking.type', value: 'adaptive' }]
        }
      }
    )

    expect(result).toMatchObject({ minimax: { thinking: { type: 'adaptive' } } })
    expect(result['openai-compatible']).toBeUndefined()
  })

  it('normalizes compatible profile emissions in the concrete provider namespace', () => {
    const result = buildCapabilityProviderOptions(
      { settings: { reasoning_effort: 'high' } } as Assistant,
      {
        id: 'dashscope::qwen3-8-max-preview',
        providerId: 'dashscope',
        name: 'Qwen3.8 Max Preview',
        capabilities: [MODEL_CAPABILITY.REASONING],
        reasoning: {
          controls: [{ kind: 'effort', values: ['low', 'medium', 'xhigh'] }],
          selectableEfforts: ['low', 'medium', 'xhigh']
        }
      } as unknown as Model,
      { id: 'dashscope', name: 'Bailian', settings: {} } as Provider,
      {
        enableReasoning: true,
        enableWebSearch: false,
        enableGenerateImage: false
      },
      {
        aiSdkProviderId: 'openai-compatible',
        runtimeProviderId: 'openai-compatible',
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        reasoning: {
          kind: 'effort',
          selection: 'high',
          effort: 'xhigh',
          emissions: [{ target: 'reasoning_effort', value: 'xhigh' }]
        }
      }
    )

    expect(result).toMatchObject({ dashscope: { reasoningEffort: 'xhigh' } })
    expect(result.dashscope.reasoning_effort).toBeUndefined()
  })

  it('encodes GitHub Copilot reasoning into the copilot namespace (its model reads `name`, not the registration id)', () => {
    const result = buildCapabilityProviderOptions(
      { settings: {} } as Assistant,
      {
        id: 'copilot::gpt-5',
        providerId: 'copilot',
        name: 'GPT-5',
        capabilities: [MODEL_CAPABILITY.REASONING]
      } as unknown as Model,
      { id: 'copilot', name: 'GitHub Copilot', settings: {} } as Provider,
      { enableReasoning: true, enableWebSearch: false, enableGenerateImage: false },
      {
        // adapterFamily/runtime id is `github-copilot-openai-compatible`, but the language model's
        // providerOptionsName is `copilot` (= actualProvider.id passed as `name`).
        aiSdkProviderId: 'github-copilot-openai-compatible',
        runtimeProviderId: 'github-copilot-openai-compatible',
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        reasoning: {
          kind: 'effort',
          selection: 'high',
          effort: 'high',
          emissions: [{ target: 'reasoning_effort', value: 'high' }]
        }
      }
    )

    // Lands in `copilot` (read namespace), snake→camel normalized, not the registration id.
    expect(result).toMatchObject({ copilot: { reasoningEffort: 'high' } })
    expect(result.copilot.reasoning_effort).toBeUndefined()
    expect(result['github-copilot-openai-compatible']).toBeUndefined()
  })

  it.each([
    ['qwen3.5-plus', 'dmxapi'],
    ['gpt-5', 'openai']
  ] as const)('encodes DMXAPI %s chat reasoning into the concrete model namespace %s', (apiModelId, key) => {
    const result = buildCapabilityProviderOptions(
      { settings: {} } as Assistant,
      {
        id: `dmxapi::${apiModelId}`,
        apiModelId,
        providerId: 'dmxapi',
        name: apiModelId,
        capabilities: [MODEL_CAPABILITY.REASONING]
      } as unknown as Model,
      { id: 'dmxapi', name: 'DMXAPI', settings: {} } as Provider,
      { enableReasoning: true, enableWebSearch: false, enableGenerateImage: false },
      {
        aiSdkProviderId: 'dmxapi',
        runtimeProviderId: 'dmxapi',
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        reasoning: {
          kind: 'effort',
          selection: 'high',
          effort: 'high',
          emissions: [{ target: 'reasoning_effort', value: 'high' }]
        }
      }
    )

    expect(result).toMatchObject({ [key]: { reasoningEffort: 'high' } })
    expect(result[key].reasoning_effort).toBeUndefined()
  })

  it('preserves an audited compatible-provider budget field in the concrete namespace', () => {
    const result = buildCapabilityProviderOptions(
      { settings: { reasoning_effort: 'high' } } as Assistant,
      {
        id: 'nvidia::nemotron-3-nano-omni-30b-a3b',
        providerId: 'nvidia',
        name: 'Nemotron 3 Nano Omni',
        capabilities: [MODEL_CAPABILITY.REASONING],
        reasoning: {
          controls: [{ kind: 'budget', min: 0, max: 32_768 }],
          selectableEfforts: ['low', 'medium', 'high'],
          thinkingTokenLimits: { min: 0, max: 32_768 }
        }
      } as unknown as Model,
      { id: 'nvidia', name: 'NVIDIA', settings: {} } as Provider,
      {
        enableReasoning: true,
        enableWebSearch: false,
        enableGenerateImage: false
      },
      {
        aiSdkProviderId: 'openai-compatible',
        runtimeProviderId: 'openai-compatible',
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        reasoning: {
          kind: 'budget',
          selection: 'high',
          budgetTokens: 26_214,
          emissions: [{ target: 'reasoning_budget', value: 26_214 }]
        }
      }
    )

    expect(result).toMatchObject({ nvidia: { reasoning_budget: 26_214 } })
    expect(result['openai-compatible']).toBeUndefined()
  })

  it.each(['google-vertex', 'google-vertex-anthropic', 'google-vertex-maas'] as const)(
    'delivers %s options through the Vertex runtime namespace',
    (runtimeProviderId) => {
      const endpointType =
        runtimeProviderId === 'google-vertex-anthropic'
          ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES
          : runtimeProviderId === 'google-vertex-maas'
            ? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
            : ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
      const result = buildCapabilityProviderOptions(
        { settings: {} } as Assistant,
        {
          id: 'vertex::test-model',
          providerId: 'vertex',
          name: 'test-model',
          capabilities: []
        } as unknown as Model,
        {
          id: 'vertex',
          settings: {},
          apiFeatures: {}
        } as Provider,
        {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        },
        {
          aiSdkProviderId: runtimeProviderId,
          runtimeProviderId,
          endpointType,
          reasoning: {
            kind: 'omit',
            selection: 'default',
            emissions: []
          }
        }
      )

      expect(result).toHaveProperty('vertex')
      expect(result).not.toHaveProperty(runtimeProviderId)
    }
  )
})
