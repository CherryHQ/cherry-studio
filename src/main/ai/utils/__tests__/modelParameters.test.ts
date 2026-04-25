import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { getMaxTokens, getTemperature, getTopP } from '../modelParameters'

// Minimal fixtures — only the fields each helper actually reads are populated,
// so the tests don't have to chase the full Assistant / Model / Provider shape.
function makeAssistant(settings: Partial<Assistant['settings']>): Assistant {
  return {
    settings: {
      temperature: 1.0,
      enableTemperature: true,
      topP: 1,
      enableTopP: false,
      maxTokens: 4096,
      enableMaxTokens: false,
      contextCount: 5,
      streamOutput: true,
      reasoning_effort: 'default',
      qwenThinkMode: false,
      mcpMode: 'auto',
      toolUseMode: 'function',
      maxToolCalls: 20,
      enableMaxToolCalls: true,
      enableWebSearch: false,
      customParameters: [],
      ...settings
    }
  } as Assistant
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4',
    providerId: 'openai',
    name: 'GPT-4',
    group: 'openai',
    parameterSupport: undefined,
    ...overrides
  } as Model
}

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'openai',
    name: 'OpenAI',
    ...overrides
  } as Provider
}

describe('getTemperature', () => {
  it('returns undefined when enableTemperature is false', () => {
    const a = makeAssistant({ enableTemperature: false, temperature: 0.7 })
    expect(getTemperature(a, makeModel())).toBeUndefined()
  })

  it('returns the temperature when the model supports it', () => {
    const a = makeAssistant({ temperature: 0.5 })
    expect(getTemperature(a, makeModel())).toBe(0.5)
  })

  it('disables temperature on Claude reasoning models with non-default reasoning effort', () => {
    const a = makeAssistant({ temperature: 0.8, reasoning_effort: 'high' })
    // A Claude reasoning model — id containing 'claude-sonnet-4-5' triggers
    // `isClaudeReasoningModel` via the shared regex.
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5-20250101',
      providerId: 'anthropic'
    })
    expect(getTemperature(a, model)).toBeUndefined()
  })

  it('keeps temperature on Claude reasoning models when reasoning_effort is default', () => {
    const a = makeAssistant({ temperature: 0.8, reasoning_effort: 'default' })
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5-20250101',
      providerId: 'anthropic'
    })
    expect(getTemperature(a, model)).toBe(0.8)
  })

  it('clamps temperature to 1 for isMaxTemperatureOneModel', () => {
    // gpt-5 is in the max-temperature-one list per shared/utils/model.
    const a = makeAssistant({ temperature: 1.5 })
    const model = makeModel({ id: 'openai::gpt-5' })
    expect(getTemperature(a, model)).toBe(1)
  })
})

describe('getTopP', () => {
  it('returns undefined when enableTopP is false', () => {
    const a = makeAssistant({ enableTopP: false, topP: 0.9 })
    expect(getTopP(a, makeModel())).toBeUndefined()
  })

  it('returns topP when enabled', () => {
    const a = makeAssistant({ enableTopP: true, topP: 0.9 })
    expect(getTopP(a, makeModel())).toBe(0.9)
  })

  it('clamps topP to [0.95, 1] on Claude reasoning models with reasoning effort', () => {
    const a = makeAssistant({ enableTopP: true, topP: 0.5, reasoning_effort: 'high' })
    const model = makeModel({
      id: 'anthropic::claude-sonnet-4-5-20250101',
      providerId: 'anthropic'
    })
    expect(getTopP(a, model)).toBe(0.95)
  })
})

describe('getMaxTokens', () => {
  it('returns undefined when enableMaxTokens is off', () => {
    const a = makeAssistant({ enableMaxTokens: false, maxTokens: 2048 })
    expect(getMaxTokens(a, makeModel(), makeProvider())).toBeUndefined()
  })

  it('returns maxTokens when enabled on non-Claude models', () => {
    const a = makeAssistant({ enableMaxTokens: true, maxTokens: 2048 })
    expect(getMaxTokens(a, makeModel(), makeProvider())).toBe(2048)
  })

  it('skips budget subtraction on Claude 4.6 series (adaptive thinking)', () => {
    const a = makeAssistant({ enableMaxTokens: true, maxTokens: 8000, reasoning_effort: 'high' })
    const model = makeModel({ id: 'anthropic::claude-sonnet-4-6-20260101', providerId: 'anthropic' })
    const provider = makeProvider({ id: 'anthropic', presetProviderId: 'anthropic' })
    expect(getMaxTokens(a, model, provider)).toBe(8000)
  })
})
