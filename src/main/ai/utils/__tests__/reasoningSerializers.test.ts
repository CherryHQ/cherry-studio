import path from 'node:path'

import {
  inferReasoningControls,
  REASONING_FORMAT_PROFILES,
  type ReasoningEffort,
  type ReasoningWireProfile
} from '@cherrystudio/provider-registry'
import { readProviderRegistry } from '@cherrystudio/provider-registry/node'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it } from 'vitest'

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
})

// A gateway request carries canonical `auto` (Claude Code's adaptive thinking, Gemini's -1 budget),
// which no model vocabulary contains. The tier the profile substitutes for it is therefore the one
// value that can reach the wire without ever being checked against the model — #20029.
describe('automatic effort against a model that does not declare it', () => {
  const autoWire = (
    autoEffort: ReasoningEffort,
    translations: Partial<Record<ReasoningEffort, ReasoningEffort>> = {}
  ) =>
    ({
      auto: {
        operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }],
        effortMap: { auto: autoEffort, ...translations }
      }
    }) satisfies ReasoningWireProfile

  const withEfforts = (...selectableEfforts: ReasoningEffort[]) =>
    makeModel({ reasoning: { controls: [{ kind: 'effort', values: selectableEfforts }], selectableEfforts } })

  it('sends the nearest declared tier instead of the provider default Kimi K3 rejects', () => {
    const invocation = resolveReasoningInvocation({
      selection: 'auto',
      model: withEfforts('low', 'high', 'max'),
      profile: autoWire('medium')
    })

    expect(encodeReasoningInvocation(invocation)).toEqual({ reasoningEffort: 'high' })
  })

  // The projection lands on a canonical tier; the map's vendor translation must still apply to it.
  it('translates the projected tier through the same effortMap', () => {
    const invocation = resolveReasoningInvocation({
      selection: 'auto',
      model: withEfforts('xhigh'),
      profile: autoWire('medium', { xhigh: 'max' })
    })

    expect(encodeReasoningInvocation(invocation)).toEqual({ reasoningEffort: 'max' })
  })

  // A toggle-only model offers no tier to project onto, so the profile's value is all there is.
  it('keeps the profile tier when the model declares no efforts', () => {
    const toggleOnly = makeModel({
      reasoning: { controls: [{ kind: 'toggle' }], selectableEfforts: ['none', 'auto'] }
    })
    const invocation = resolveReasoningInvocation({ selection: 'auto', model: toggleOnly, profile: autoWire('medium') })

    expect(encodeReasoningInvocation(invocation)).toEqual({ reasoningEffort: 'medium' })
  })

  // An explicit selection was already clamped to the model; its map entry is a vendor rename.
  it('leaves an explicitly selected effort untouched by the projection', () => {
    const invocation = resolveReasoningInvocation({
      selection: 'xhigh',
      model: withEfforts('low', 'xhigh'),
      profile: {
        effort: {
          operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }],
          effortMap: { xhigh: 'max' }
        }
      }
    })

    expect(encodeReasoningInvocation(invocation)).toEqual({ reasoningEffort: 'max' })
  })
})

describe('OpenAI Responses reasoning summary', () => {
  const responsesWire = (providerId: string) =>
    readProviderRegistry(path.join(process.cwd(), 'packages/provider-registry/data/providers.json')).providers.find(
      (provider) => provider.id === providerId
    )?.endpointConfigs?.['openai-responses']?.reasoningFormat?.wire
  const openaiWire = responsesWire('openai')!
  const arkWire = responsesWire('doubao')
  const gpt5 = makeModel({
    reasoning: {
      controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
      selectableEfforts: ['low', 'medium', 'high']
    }
  })

  // Without `reasoning.summary` OpenAI returns no summary at all, so the provider default must
  // travel even when the user never picks an effort tier.
  it('emits the summary default on the Default selection, with no effort', () => {
    const invocation = resolveReasoningInvocation({ selection: 'default', model: gpt5, profile: openaiWire })
    expect(encodeReasoningInvocation(invocation)).toEqual({ reasoningSummary: 'auto' })
  })

  it('lets an explicit assistant selection override the default', () => {
    const invocation = resolveReasoningInvocation({
      selection: 'high',
      model: gpt5,
      profile: openaiWire,
      assistantSummary: 'detailed'
    })
    expect(encodeReasoningInvocation(invocation)).toEqual({ reasoningEffort: 'high', reasoningSummary: 'detailed' })
  })

  // Ark rejects the field outright (400 `unknown field "summary"`).
  it('never emits a summary for third-party Responses hosts', () => {
    const profile = arkWire ?? REASONING_FORMAT_PROFILES['openai-responses'].wire
    const invocation = resolveReasoningInvocation({
      selection: 'high',
      model: gpt5,
      profile,
      assistantSummary: 'detailed'
    })
    expect(encodeReasoningInvocation(invocation)).toEqual({ reasoningEffort: 'high' })
  })
})

describe('resolveReasoningInvocation logging', () => {
  beforeEach(() => mockMainLoggerService.info.mockClear())

  // `resolveReasoningInvocation` runs for every message. 'default' means the user asked for
  // nothing, and it reaches the omit paths on ordinary traffic: any non-reasoning model, plus
  // every wire profile without a `default` mode — 13 of the 17 shipped ones.
  it('says nothing when the user made no reasoning selection', () => {
    resolveReasoningInvocation({
      selection: 'default',
      model: makeModel({ reasoning: undefined }),
      profile: budgetProfile,
      maxTokens: 8192
    })

    expect(mockMainLoggerService.info).not.toHaveBeenCalled()
  })

  it('records a selection the user made that could not be honoured', () => {
    resolveReasoningInvocation({ selection: 'high', model, profile: budgetProfile, maxTokens: 256 })

    expect(mockMainLoggerService.info).toHaveBeenCalledOnce()
    expect(mockMainLoggerService.info.mock.calls[0][0]).toContain("Reasoning 'high' not sent")
  })
})
