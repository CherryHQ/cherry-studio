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

  it('does not invent a fixed three-effort fallback when capability metadata is missing', () => {
    const modelWithoutEfforts = model({ apiModelId: 'gpt-5.3-codex-spark' })

    expect(getAgentReasoningEfforts(modelWithoutEfforts)).toEqual([])
    expect(supportsAgentSpeedControl(modelWithoutEfforts)).toBe(false)
  })

  it('uses the model reasoning effort order and filters unsupported agent values', () => {
    expect(
      getAgentReasoningEfforts(
        model({ reasoning: { type: 'effort', supportedEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] } })
      )
    ).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('starts from the model default effort when it is available', () => {
    expect(
      getDefaultAgentReasoningEffort(
        model({ reasoning: { type: 'effort', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'high' } })
      )
    ).toBe('high')
  })

  it('reads Fast support from model registry metadata', () => {
    expect(supportsAgentFastMode(model({ apiModelId: 'gpt-5.6-sol', supportsFastMode: true }))).toBe(true)
    expect(supportsAgentFastMode(model({ apiModelId: 'gpt-5.6-sol' }))).toBe(false)
    expect(supportsAgentFastMode(model({ apiModelId: 'gpt-5.3-codex-spark', supportsFastMode: false }))).toBe(false)
  })
})
