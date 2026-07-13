import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  getAgentReasoningEfforts,
  getDefaultAgentReasoningEffort,
  supportsAgentFastMode,
  supportsAgentSpeedControl
} from '../AgentSpeedControl'

function model(overrides: Partial<Model>): Model {
  return {
    id: 'model',
    providerId: 'openai-codex',
    name: 'Model',
    capabilities: [],
    ...overrides
  } as Model
}

describe('AgentSpeedControl model capabilities', () => {
  it('exposes all six Codex reasoning efforts for GPT-5.6', () => {
    expect(
      getAgentReasoningEfforts(
        model({
          apiModelId: 'gpt-5.6-sol',
          reasoning: { type: 'openai-responses', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }
        })
      )
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  })

  it('preserves each model capability list instead of padding it to six efforts', () => {
    expect(
      getAgentReasoningEfforts(
        model({
          apiModelId: 'gpt-5.5',
          reasoning: { type: 'openai-responses', supportedEfforts: ['low', 'medium', 'high', 'xhigh'] }
        })
      )
    ).toEqual(['low', 'medium', 'high', 'xhigh'])

    expect(
      getAgentReasoningEfforts(
        model({
          providerId: 'claude-code',
          apiModelId: 'claude-opus-4-8',
          reasoning: { type: 'anthropic', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }
        })
      )
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])

    expect(
      getAgentReasoningEfforts(
        model({
          providerId: 'claude-code',
          apiModelId: 'claude-sonnet-4-6',
          reasoning: { type: 'anthropic', supportedEfforts: ['low', 'medium', 'high', 'max'] }
        })
      )
    ).toEqual(['low', 'medium', 'high', 'max'])

    const unsupportedClaude = model({
      providerId: 'claude-code',
      apiModelId: 'claude-haiku-4-5',
      reasoning: { type: 'anthropic', supportedEfforts: [] }
    })
    expect(getAgentReasoningEfforts(unsupportedClaude)).toEqual([])
    expect(supportsAgentSpeedControl(unsupportedClaude)).toBe(false)
  })

  it('does not invent effort or off capabilities when registry metadata is missing', () => {
    const modelWithoutEfforts = model({
      id: 'provider-1::reasoning-model',
      providerId: 'provider-1',
      apiModelId: 'reasoning-model',
      capabilities: ['reasoning']
    })

    expect(getAgentReasoningEfforts(modelWithoutEfforts)).toEqual([])
    expect(supportsAgentSpeedControl(modelWithoutEfforts)).toBe(false)
  })

  it('does not show the control for a model without thinking support', () => {
    const textModel = model({ id: 'provider-1::text-model', providerId: 'provider-1', apiModelId: 'text-model' })

    expect(getAgentReasoningEfforts(textModel)).toEqual([])
    expect(supportsAgentSpeedControl(textModel)).toBe(false)
  })

  it('uses effort capabilities for every provider', () => {
    const providerModel = model({
      providerId: 'provider-1',
      reasoning: { type: 'openai-responses', supportedEfforts: ['low', 'medium', 'high'] }
    })

    expect(supportsAgentSpeedControl(providerModel)).toBe(true)
  })

  it('uses the full model reasoning effort order', () => {
    expect(
      getAgentReasoningEfforts(
        model({
          reasoning: {
            type: 'openai-responses',
            supportedEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh']
          }
        })
      )
    ).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
  })

  it('starts auto-only thinking models in automatic mode', () => {
    expect(
      getDefaultAgentReasoningEffort(
        model({ reasoning: { type: 'openai-responses', supportedEfforts: ['none', 'auto'] } })
      )
    ).toBe('auto')
  })

  it('starts from the model default effort when it is available', () => {
    expect(
      getDefaultAgentReasoningEffort(
        model({
          reasoning: {
            type: 'openai-responses',
            supportedEfforts: ['low', 'medium', 'high'],
            defaultEffort: 'high'
          }
        })
      )
    ).toBe('high')
  })

  it('reads Fast support from model registry metadata', () => {
    expect(supportsAgentFastMode(model({ providerId: 'claude-code', apiModelId: 'claude-fable-5' }))).toBe(false)
    expect(supportsAgentFastMode(model({ providerId: 'claude-code', apiModelId: 'claude-opus-4-8' }))).toBe(false)
    expect(
      supportsAgentFastMode(model({ providerId: 'claude-code', apiModelId: 'claude-opus-4-8', supportsFastMode: true }))
    ).toBe(true)
    expect(supportsAgentFastMode(model({ apiModelId: 'gpt-5.6-sol', supportsFastMode: true }))).toBe(true)
    expect(supportsAgentFastMode(model({ apiModelId: 'gpt-5.6-sol' }))).toBe(false)
    expect(supportsAgentFastMode(model({ apiModelId: 'gpt-5.3-codex-spark', supportsFastMode: false }))).toBe(false)
  })
})
