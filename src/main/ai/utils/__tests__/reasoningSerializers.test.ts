import {
  inferReasoningControls,
  REASONING_FORMAT_PROFILES,
  type ReasoningWireProfile
} from '@cherrystudio/provider-registry'
import { describe, expect, it } from 'vitest'

import { makeModel } from '../../__tests__/fixtures'
import { encodeReasoningInvocation, resolveReasoningInvocation } from '../reasoningSerializers'

const budgetProfile: ReasoningWireProfile = {
  effort: {
    operations: [{ target: 'thinking.budgetTokens', value: { source: 'budget' } }],
    budget: { min: 1024, missing: { type: 'fallback', value: 13_312 }, clampToMaxTokens: true }
  }
}

const model = makeModel({
  reasoning: {
    controls: [{ kind: 'budget', min: 1024, max: 64_000 }],
    selectableEfforts: ['high'],
    thinkingTokenLimits: { min: 1024, max: 64_000 }
  }
})

describe('resolveReasoningInvocation budget constraints', () => {
  it.each([256, 1024])('omits a budget mode when maxTokens=%i cannot satisfy its minimum', (maxTokens) => {
    expect(resolveReasoningInvocation({ selection: 'high', model, profile: budgetProfile, maxTokens })).toEqual({
      kind: 'omit',
      selection: 'high',
      emissions: []
    })
  })

  it('clamps budget below maxTokens while preserving the declared minimum', () => {
    const result = resolveReasoningInvocation({ selection: 'high', model, profile: budgetProfile, maxTokens: 8192 })

    expect(result.kind).toBe('budget')
    expect(result.budgetTokens).toBe(8191)
    expect(result.budgetTokens).toBeGreaterThanOrEqual(1024)
    expect(result.budgetTokens).toBeLessThan(8192)
  })

  it('encodes an audited provider budget target without serializer model branches', () => {
    const profile: ReasoningWireProfile = {
      effort: {
        operations: [{ target: 'reasoning_budget', value: { source: 'budget' } }],
        budget: { min: 1, missing: { type: 'omit-mode' } }
      }
    }
    const invocation = resolveReasoningInvocation({ selection: 'high', model, profile })

    expect(encodeReasoningInvocation(invocation)).toEqual({ reasoning_budget: 51_404 })
  })

  it('encodes an audited nested string toggle target', () => {
    const profile: ReasoningWireProfile = {
      auto: {
        operations: [{ target: 'chat_template_kwargs.thinking_mode', value: { source: 'literal', value: 'adaptive' } }]
      }
    }
    const toggleModel = makeModel({
      reasoning: { controls: [{ kind: 'toggle' }], selectableEfforts: ['none', 'auto'] }
    })
    const invocation = resolveReasoningInvocation({ selection: 'auto', model: toggleModel, profile })

    expect(encodeReasoningInvocation(invocation)).toEqual({ chat_template_kwargs: { thinking_mode: 'adaptive' } })
  })

  it('encodes Gemma 4 thinking control as Ollama booleans', () => {
    const controls = inferReasoningControls('gemma4:31b')
    expect(controls).toEqual([{ kind: 'toggle' }])

    const gemma4 = makeModel({
      reasoning: { controls, selectableEfforts: ['none', 'auto'] }
    })
    const profile = REASONING_FORMAT_PROFILES.ollama.wire

    const enabled = resolveReasoningInvocation({ selection: 'auto', model: gemma4, profile })
    const disabled = resolveReasoningInvocation({ selection: 'none', model: gemma4, profile })

    expect(encodeReasoningInvocation(enabled)).toEqual({ think: true })
    expect(encodeReasoningInvocation(disabled)).toEqual({ think: false })
  })

  it('encodes the self-hosted chat_template_kwargs wire for toggle models', () => {
    const toggleModel = makeModel({
      reasoning: { controls: [{ kind: 'toggle' }], selectableEfforts: ['none', 'auto'] }
    })
    const profile = REASONING_FORMAT_PROFILES['self-hosted'].wire

    const enabled = resolveReasoningInvocation({ selection: 'auto', model: toggleModel, profile })
    expect(enabled.kind).toBe('budget')
    expect(encodeReasoningInvocation(enabled)).toEqual({
      chat_template_kwargs: { enable_thinking: true, thinking_budget: 4096 }
    })

    const disabled = resolveReasoningInvocation({ selection: 'none', model: toggleModel, profile })
    expect(encodeReasoningInvocation(disabled)).toEqual({ chat_template_kwargs: { enable_thinking: false } })
  })

  it('encodes the self-hosted chat_template_kwargs wire with a model-declared budget', () => {
    const profile = REASONING_FORMAT_PROFILES['self-hosted'].wire

    const enabled = resolveReasoningInvocation({ selection: 'high', model, profile })
    expect(enabled.kind).toBe('budget')
    const encoded = encodeReasoningInvocation(enabled) as {
      chat_template_kwargs: { enable_thinking: boolean; thinking_budget: number }
    }
    expect(encoded.chat_template_kwargs.enable_thinking).toBe(true)
    expect(encoded.chat_template_kwargs.thinking_budget).toBeGreaterThanOrEqual(1024)
  })
})
