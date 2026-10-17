import { describe, expect, it } from 'vitest'

import type { SamplingSettings } from '@main/ai/types'
import type { AssistantSettings } from '@shared/data/types/assistant'
import { MODEL_CAPABILITY } from '@shared/data/types/model'

import { makeAssistant as makeAssistantBase, makeModel } from '../../__tests__/fixtures'
import {
  adjustMaxOutputTokensForReasoning,
  filterStandardParams,
  getTemperature,
  getTopP,
  stripUnsupportedModelParams
} from '../modelParameters'

const OMIT_REASONING = { kind: 'omit' } as const
const OFF_REASONING = { kind: 'off' } as const
const EFFORT_REASONING = { kind: 'effort' } as const
const NO_BUDGET = { budgetTokens: undefined }

// modelParameters tests treat `enableTemperature: true` as the baseline,
// unlike DEFAULT_ASSISTANT_SETTINGS which has it false. Local wrapper keeps
// per-test settings calls terse.
function makeSampling(settings: Partial<AssistantSettings> = {}): SamplingSettings {
  return makeAssistantBase({ settings: { enableTemperature: true, ...settings } }).settings
}

describe('stripUnsupportedModelParams', () => {
  describe('DashScope Qwen temperature normalization', () => {
    const model = makeModel({ id: 'dashscope::qwen-long', providerId: 'dashscope' })

    it.each([2, 2.0000001, 2.5, 3])(
      'normalizes %j to 1.9 in every request container without mutating inputs',
      (temperature) => {
        const metadata = Object.freeze({ temperature: 2 })
        const values = Object.freeze({ temperature, topP: 0.8, metadata })
        const params = Object.freeze({
          standardParams: values,
          providerOptions: Object.freeze({ dashscope: values, other: values }),
          bodyParams: values
        })
        const result = stripUnsupportedModelParams(params, model)
        expect(result).not.toBe(params)
        expect(result.providerOptions).not.toBe(params.providerOptions)
        for (const container of [result.standardParams, ...Object.values(result.providerOptions), result.bodyParams]) {
          expect(container).not.toBe(values)
          expect(container.temperature).toBe(1.9)
          expect(container.topP).toBe(0.8)
          expect(container.metadata).toBe(metadata)
        }
        expect(values.temperature).toBe(temperature)
        expect(metadata.temperature).toBe(2)
      }
    )

    // Invariant rows pass on both versions; they do not prove the bug was caught.
    it.each([0, 1, 0.7, 1.5, 1.9, 1.99, 1.9999, NaN, Infinity, -Infinity, '2', null, true, {}, -1, -0.1])(
      'preserves %j in every request container',
      (temperature) => {
        const values = { temperature }
        const result = stripUnsupportedModelParams(
          { standardParams: values, providerOptions: { dashscope: values, other: values }, bodyParams: values },
          model
        )
        for (const container of [result.standardParams, ...Object.values(result.providerOptions), result.bodyParams]) {
          expect(container.temperature).toBe(temperature)
        }
      }
    )

    it('does not add absent temperatures', () => {
      const result = stripUnsupportedModelParams(
        { standardParams: {}, providerOptions: { dashscope: {}, other: {} }, bodyParams: {} },
        model
      )
      for (const container of [result.standardParams, ...Object.values(result.providerOptions), result.bodyParams]) {
        expect(container).not.toHaveProperty('temperature')
      }
    })

    it('deletes unsupported temperatures before normalization', () => {
      const result = stripUnsupportedModelParams(
        {
          standardParams: { temperature: 2 },
          providerOptions: { dashscope: { temperature: 2 }, other: { temperature: 2 } },
          bodyParams: { temperature: 2 }
        },
        {
          ...model,
          parameterSupport: {
            temperature: { supported: false, min: 0, max: 2 },
            maxTokens: true,
            stopSequences: true,
            systemMessage: true
          }
        }
      )
      for (const container of [result.standardParams, ...Object.values(result.providerOptions), result.bodyParams]) {
        expect(container).not.toHaveProperty('temperature')
      }
    })

    it.each([
      ['other', 'qwen-long'],
      ['dashscope', 'deepseek-v3'],
      ['dashscope', 'glm-4'],
      ['dashscope', 'kimi-k3']
    ])('preserves temperature for unmatched %s / %s models', (providerId, apiModelId) => {
      const result = stripUnsupportedModelParams(
        {
          standardParams: { temperature: 2 },
          providerOptions: { dashscope: { temperature: 2 }, other: { temperature: 2 } },
          bodyParams: { temperature: 2 }
        },
        makeModel({ id: `${providerId}::${apiModelId}`, providerId, apiModelId })
      )
      for (const container of [result.standardParams, ...Object.values(result.providerOptions), result.bodyParams]) {
        expect(container.temperature).toBe(2)
      }
    })
  })

  it.each(['gemini-4-argon', 'google/gemini-4-argon', 'models/gemini-4-argon'])(
    'removes Argon sampling and explicit cache references after overrides for %s',
    (apiModelId) => {
      const parameters = Object.freeze({
        temperature: 0.5,
        topP: 0.8,
        top_p: 0.8,
        topK: 40,
        top_k: 40,
        cachedContent: 'cachedContents/old',
        cached_content: 'cachedContents/old',
        maxOutputTokens: 131072,
        continuationToken: 'resume',
        thinkingConfig: { thinkingLevel: 'medium' },
        metadata: { top_k: 'application data' }
      })
      const model = makeModel({ id: `custom::${apiModelId}`, apiModelId })
      const cleaned = stripUnsupportedModelParams(
        {
          standardParams: parameters,
          providerOptions: { google: parameters, vertex: parameters },
          bodyParams: parameters
        },
        model
      )
      const expected = {
        maxOutputTokens: 131072,
        continuationToken: 'resume',
        thinkingConfig: { thinkingLevel: 'medium' },
        metadata: { top_k: 'application data' }
      }
      expect(cleaned).toEqual({
        standardParams: expected,
        providerOptions: { google: expected, vertex: expected },
        bodyParams: expected
      })
      expect(getTemperature(makeSampling(), model, OMIT_REASONING)).toBeUndefined()
      expect(getTopP(makeSampling({ enableTopP: true }), model, OMIT_REASONING)).toBeUndefined()
      expect(parameters.cachedContent).toBe('cachedContents/old')
    }
  )

  it.each([
    { temperature: false, topP: false, standard: {}, wire: {} },
    { temperature: false, topP: true, standard: { topP: 0.8 }, wire: { topP: 0.8, top_p: 0.8 } },
    { temperature: true, topP: false, standard: { temperature: 0.3 }, wire: { temperature: 0.3 } },
    {
      temperature: true,
      topP: true,
      standard: { temperature: 0.3, topP: 0.8 },
      wire: { temperature: 0.3, topP: 0.8, top_p: 0.8 }
    },
    {
      temperature: undefined,
      topP: undefined,
      standard: { temperature: 0.3, topP: 0.8 },
      wire: { temperature: 0.3, topP: 0.8, top_p: 0.8 }
    }
  ])(
    'enforces temperature=$temperature and topP=$topP independently without mutating inputs',
    ({ temperature, topP, standard, wire }) => {
      const model = makeModel({
        parameterSupport: {
          temperature: temperature === undefined ? undefined : { supported: temperature, min: 0, max: 1 },
          topP: topP === undefined ? undefined : { supported: topP, min: 0, max: 1 },
          maxTokens: true,
          stopSequences: true,
          systemMessage: true
        }
      })
      const standardParams = Object.freeze({ temperature: 0.3, topP: 0.8, maxOutputTokens: 100 })
      const wireParams = Object.freeze({
        temperature: 0.3,
        topP: 0.8,
        top_p: 0.8,
        user: 'kept',
        metadata: Object.freeze({ temperature: 'business data', top_p: 42 })
      })
      const params = Object.freeze({
        standardParams,
        providerOptions: Object.freeze({ openai: wireParams, other: wireParams }),
        bodyParams: wireParams
      })
      const result = stripUnsupportedModelParams(params, model)
      expect(result.standardParams).toEqual({ ...standard, maxOutputTokens: 100 })
      const expectedWire = {
        ...wire,
        user: 'kept',
        metadata: { temperature: 'business data', top_p: 42 }
      }
      expect(result.providerOptions).toEqual({ openai: expectedWire, other: expectedWire })
      expect(result.bodyParams).toEqual(expectedWire)
      expect(stripUnsupportedModelParams(result, model)).toEqual(result)
    }
  )
})

describe('getTemperature', () => {
  it('returns undefined when enableTemperature is false', () => {
    const a = makeSampling({ enableTemperature: false, temperature: 0.7 })
    expect(getTemperature(a, makeModel(), OMIT_REASONING)).toBeUndefined()
  })

  it('returns the temperature when the model supports it', () => {
    const a = makeSampling({ temperature: 0.5 })
    expect(getTemperature(a, makeModel(), OMIT_REASONING)).toBe(0.5)
  })

  it('disables temperature from the request snapshot even when the persisted effort is default', () => {
    const a = makeSampling({ temperature: 0.8, reasoning_effort: 'default' })
    // `isClaudeReasoningModel` = Anthropic vendor + REASONING capability
    // (the registry sets the capability via `inferClaudeReasoningFromId`;
    // tests have to populate it explicitly because they bypass the registry).
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5-20250101',
      providerId: 'anthropic',
      capabilities: [MODEL_CAPABILITY.REASONING]
    })
    expect(getTemperature(a, model, EFFORT_REASONING)).toBeUndefined()
  })

  it('keeps temperature from the request snapshot even when the persisted effort is high', () => {
    const a = makeSampling({ temperature: 0.8, reasoning_effort: 'high' })
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5-20250101',
      providerId: 'anthropic',
      capabilities: [MODEL_CAPABILITY.REASONING]
    })
    expect(getTemperature(a, model, OFF_REASONING)).toBe(0.8)
  })

  it('clamps temperature to 1 for isMaxTemperatureOneModel', () => {
    // `isMaxTemperatureOneModel` first reads `parameterSupport.temperature.max`;
    // its id-based fallback covers `claude/glm/kimi/moonshot` only — gpt-5
    // is classified by the registry, not the fallback, so the test has to
    // declare the parameter support explicitly.
    const a = makeSampling({ temperature: 1.5 })
    const model = makeModel({
      id: 'openai::gpt-5',
      parameterSupport: {
        temperature: { supported: true, min: 0, max: 1 },
        maxTokens: true,
        stopSequences: true,
        systemMessage: true
      }
    })
    expect(getTemperature(a, model, OMIT_REASONING)).toBe(1)
  })

  it('omits temperature when the resolved provider-model marks it unsupported', () => {
    const a = makeSampling({ temperature: 0.7 })
    const model = makeModel({
      id: 'moonshot::kimi-k2-6',
      providerId: 'moonshot',
      parameterSupport: {
        temperature: { supported: false, min: 0, max: 1 },
        maxTokens: true,
        stopSequences: true,
        systemMessage: true
      }
    })

    expect(getTemperature(a, model, OMIT_REASONING)).toBeUndefined()
  })

  it.each(['kimi-k2.5', 'kimi-k2.7-code', 'kimi-k3'])(
    'does not infer Moonshot temperature constraints for a third-party %s model',
    (id) => {
      const a = makeSampling({ temperature: 0.7 })
      expect(getTemperature(a, makeModel({ id: `third-party::${id}` }), OMIT_REASONING)).toBe(0.7)
    }
  )

  it('disables temperature for Gemini 3.x models', () => {
    const a = makeSampling({ temperature: 0.8 })
    const model = makeModel({ id: 'gemini::gemini-3-pro' })
    expect(getTemperature(a, model, OMIT_REASONING)).toBeUndefined()
  })

  it('disables temperature for Claude Opus 4.7 models', () => {
    const a = makeSampling({ temperature: 0.8 })
    const model = makeModel({ id: 'anthropic::claude-opus-4-7-20260101', providerId: 'anthropic' })
    expect(getTemperature(a, model, OMIT_REASONING)).toBeUndefined()
  })
})

describe('getTopP', () => {
  it('returns undefined when enableTopP is false', () => {
    const a = makeSampling({ enableTopP: false, topP: 0.9 })
    expect(getTopP(a, makeModel(), OMIT_REASONING)).toBeUndefined()
  })

  it('returns topP when enabled', () => {
    const a = makeSampling({ enableTopP: true, topP: 0.9 })
    expect(getTopP(a, makeModel(), OMIT_REASONING)).toBe(0.9)
  })

  it('omits topP when the resolved provider-model marks it unsupported', () => {
    const a = makeSampling({ enableTopP: true, topP: 1 })
    const model = makeModel({
      id: 'moonshot::kimi-k3',
      providerId: 'moonshot',
      parameterSupport: {
        topP: { supported: false, min: 0, max: 1 },
        maxTokens: true,
        stopSequences: true,
        systemMessage: true
      }
    })

    expect(getTopP(a, model, OMIT_REASONING)).toBeUndefined()
  })

  it.each(['kimi-k2.5', 'kimi-k2.7-code', 'kimi-k3'])(
    'does not infer Moonshot topP constraints for a third-party %s model',
    (id) => {
      const a = makeSampling({ enableTopP: true, topP: 1 })
      expect(getTopP(a, makeModel({ id: `third-party::${id}` }), OMIT_REASONING)).toBe(1)
    }
  )

  it('clamps topP to [0.95, 1] from the resolved request reasoning', () => {
    // `enableTemperature: false` — Claude 4.5 has mutually-exclusive
    // temperature/topP (`isTemperatureTopPMutuallyExclusiveModel`); leaving
    // both enabled would short-circuit topP via the exclusivity branch and
    // never reach the reasoning-clamp path under test.
    const a = makeSampling({ enableTemperature: false, enableTopP: true, topP: 0.5, reasoning_effort: 'high' })
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5-20250101',
      providerId: 'anthropic',
      capabilities: [MODEL_CAPABILITY.REASONING]
    })
    expect(getTopP(a, model, EFFORT_REASONING)).toBe(0.95)
  })

  it('disables topP for Gemini 3.x models', () => {
    const a = makeSampling({ enableTopP: true, topP: 0.8 })
    const model = makeModel({ id: 'gemini::gemini-3-pro' })
    expect(getTopP(a, model, OMIT_REASONING)).toBeUndefined()
  })

  it('disables topP for Claude Opus 4.7 models', () => {
    const a = makeSampling({ enableTopP: true, topP: 0.8 })
    const model = makeModel({ id: 'anthropic::claude-opus-4-7-20260101', providerId: 'anthropic' })
    expect(getTopP(a, model, OMIT_REASONING)).toBeUndefined()
  })
})

describe('filterStandardParams', () => {
  it('drops topK for Gemini 3.x models', () => {
    const model = makeModel({ id: 'gemini::gemini-3-pro' })
    expect(filterStandardParams({ topK: 40, frequencyPenalty: 0.1 }, model)).toEqual({ frequencyPenalty: 0.1 })
  })

  it('drops topK for Claude Opus 4.7 models', () => {
    const model = makeModel({ id: 'anthropic::claude-opus-4-7-20260101', providerId: 'anthropic' })
    expect(filterStandardParams({ topK: 40, frequencyPenalty: 0.1 }, model)).toEqual({ frequencyPenalty: 0.1 })
  })

  it('keeps topK for other models', () => {
    const input = { topK: 40 }
    expect(filterStandardParams(input, makeModel())).toBe(input)
  })
})

describe('adjustMaxOutputTokensForReasoning', () => {
  it('preserves an undefined max output limit', () => {
    expect(adjustMaxOutputTokensForReasoning(undefined, 'anthropic-messages', NO_BUDGET)).toBeUndefined()
  })

  it('does not subtract a budget for non-Anthropic endpoints', () => {
    expect(adjustMaxOutputTokensForReasoning(8000, 'openai-chat-completions', { budgetTokens: 4000 })).toBe(8000)
  })

  it('subtracts an explicit thinking budget for Anthropic Messages regardless of model family', () => {
    expect(adjustMaxOutputTokensForReasoning(8000, 'anthropic-messages', { budgetTokens: 4000 })).toBe(4000)
  })

  it('does not subtract when adaptive thinking has no explicit budget', () => {
    expect(adjustMaxOutputTokensForReasoning(8000, 'anthropic-messages', NO_BUDGET)).toBe(8000)
  })

  it('keeps at least one non-thinking output token', () => {
    expect(adjustMaxOutputTokensForReasoning(8000, 'anthropic-messages', { budgetTokens: 8000 })).toBe(1)
  })
})

describe('sampling settings that do not come from an assistant', () => {
  it("are gated by model capability just like an assistant's", () => {
    // Anthropic ids are the id-based `isMaxTemperatureOneModel` fallback.
    const model = makeModel({ id: 'anthropic::claude-3-5-sonnet', providerId: 'anthropic' })

    expect(getTemperature(makeSampling({ temperature: 1.5 }), model, OMIT_REASONING)).toBe(1)
  })
})
