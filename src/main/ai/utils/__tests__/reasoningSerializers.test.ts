import type { ReasoningWireProfile } from '@cherrystudio/provider-registry'
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
})
