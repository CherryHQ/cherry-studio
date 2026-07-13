import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  getAgentReasoningEfforts,
  getDefaultAgentReasoningEffort,
  supportsAgentFastMode
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

  it('recognizes Fast only on supported Codex and Claude Code models', () => {
    expect(supportsAgentFastMode(model({ apiModelId: 'gpt-5.4' }))).toBe(true)
    expect(supportsAgentFastMode(model({ apiModelId: 'gpt-5.4-mini' }))).toBe(true)
    expect(supportsAgentFastMode(model({ apiModelId: 'gpt-5.3-codex-spark' }))).toBe(false)
    expect(
      supportsAgentFastMode(model({ providerId: 'claude-code', apiModelId: 'claude-opus-4-8-20260701' }))
    ).toBe(true)
    expect(supportsAgentFastMode(model({ providerId: 'claude-code', apiModelId: 'claude-sonnet-4-6' }))).toBe(false)
  })
})
