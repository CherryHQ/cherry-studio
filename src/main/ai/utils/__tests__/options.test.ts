import type { Assistant } from '@shared/data/types/assistant'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
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
  it('passes provider summaryText settings into OpenAI reasoning options', () => {
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
        supportedEfforts: ['low', 'medium', 'high']
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
      settings: {
        summaryText: 'detailed'
      },
      isEnabled: true
    } as Provider

    const result = buildCapabilityProviderOptions(assistant, model, provider, {
      enableReasoning: true,
      enableWebSearch: false,
      enableGenerateImage: false
    })

    expect(result.openai.reasoningSummary).toBe('detailed')
  })
})
