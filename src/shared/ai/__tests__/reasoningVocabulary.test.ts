/**
 * deriveThinkingOptions parity review (#16598 Phase 5).
 *
 * Each case pairs a family exemplar's DESCRIPTOR (as the registry ships it
 * post-Phase-3) with the derived UI options, annotated with the legacy
 * `MODEL_SUPPORTED_OPTIONS` row it replaces. Divergences from the legacy
 * table are DELIBERATE and documented inline (native tiers, ladder over
 * toggle+budget) — this file is the review record.
 */
import type { Model, RuntimeReasoning } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { deriveThinkingOptions, nearestThinkingOption } from '../reasoningVocabulary'

const model = (reasoning?: RuntimeReasoning, capabilities: string[] = ['reasoning']): Model =>
  ({
    id: 'p::m',
    providerId: 'p',
    apiModelId: 'm',
    name: 'm',
    capabilities,
    reasoning,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }) as Model

describe('deriveThinkingOptions', () => {
  it('non-reasoning model → undefined', () => {
    expect(deriveThinkingOptions(model(undefined, []))).toBeUndefined()
  })

  it('fixed reasoning (no descriptor: r1, minimax) → undefined (legacy: disabled control)', () => {
    expect(deriveThinkingOptions(model(undefined))).toBeUndefined()
  })

  it("'none'-format provider (groq): empty vocabulary → undefined (legacy: tower skipped groq)", () => {
    expect(
      deriveThinkingOptions(
        model({ type: 'none', controls: [{ kind: 'effort', values: ['low'] }], supportedEfforts: [] })
      )
    ).toBeUndefined()
  })

  it("'none' dialect vetoes the budget/toggle ladders too — the wire always serializes {}", () => {
    expect(
      deriveThinkingOptions(
        model({
          type: 'none',
          controls: [{ kind: 'budget', min: 1024, max: 32000 }, { kind: 'toggle' }],
          supportedEfforts: [],
          thinkingTokenLimits: { min: 1024, max: 32000 }
        })
      )
    ).toBeUndefined()
  })

  it("'disable-reasoning' dialect can only express OFF → default + none, whatever the controls", () => {
    expect(
      deriveThinkingOptions(
        model({
          type: 'disable-reasoning',
          controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
          supportedEfforts: ['low', 'medium', 'high']
        })
      )
    ).toEqual(['default', 'none'])
  })

  it('effort control → default + native values in declared order (gpt-5.2; legacy gpt5_2 identical)', () => {
    expect(
      deriveThinkingOptions(
        model({
          type: 'openai-chat',
          controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
          supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh']
        })
      )
    ).toEqual(['default', 'none', 'low', 'medium', 'high', 'xhigh'])
  })

  it("claude 4.6 → native 'max' tier (legacy claude46 showed the 'xhigh' alias)", () => {
    expect(
      deriveThinkingOptions(
        model({
          type: 'anthropic',
          controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'max'] }, { kind: 'toggle' }],
          // generation appends 'none' for the toggle
          supportedEfforts: ['low', 'medium', 'high', 'max', 'none']
        })
      )
    ).toEqual(['default', 'none', 'low', 'medium', 'high', 'max'])
  })

  it('toggle+budget (claude pre-4.6 / qwen) → off + preset ladder (legacy claude/qwen identical)', () => {
    expect(
      deriveThinkingOptions(
        model({
          type: 'openai-chat',
          controls: [{ kind: 'budget', min: 1024, max: 64_000 }, { kind: 'toggle' }],
          supportedEfforts: ['none', 'auto'],
          thinkingTokenLimits: { min: 1024, max: 64_000 }
        })
      )
    ).toEqual(['default', 'none', 'low', 'medium', 'high'])
  })

  it('budget only (gemini 2.5 pro — cannot disable) → ladder without off (legacy gemini2_pro had auto; dropped)', () => {
    expect(
      deriveThinkingOptions(
        model({
          type: 'gemini',
          controls: [{ kind: 'budget', min: 128, max: 32_768 }],
          supportedEfforts: [],
          thinkingTokenLimits: { min: 128, max: 32_768 }
        })
      )
    ).toEqual(['default', 'low', 'medium', 'high'])
  })

  it('toggle only (deepseek v3.x hybrid) → on/off (legacy deepseek_hybrid identical)', () => {
    expect(
      deriveThinkingOptions(
        model({ type: 'thinking-type', controls: [{ kind: 'toggle' }], supportedEfforts: ['none', 'auto'] })
      )
    ).toEqual(['default', 'none', 'auto'])
  })

  it('doubao auto SKU → effort control incl. auto (legacy doubao identical)', () => {
    expect(
      deriveThinkingOptions(
        model({
          type: 'thinking-type',
          controls: [
            { kind: 'effort', values: ['none', 'auto', 'high'] },
            { kind: 'budget', min: 0, max: 30_720 }
          ],
          supportedEfforts: ['none', 'auto', 'high'],
          thinkingTokenLimits: { min: 0, max: 30_720 }
        })
      )
    ).toEqual(['default', 'none', 'auto', 'high'])
  })

  it('legacy descriptor without controls (stored rows) → supportedEfforts as-is', () => {
    expect(deriveThinkingOptions(model({ type: 'openai-chat', supportedEfforts: ['low', 'medium', 'high'] }))).toEqual([
      'default',
      'low',
      'medium',
      'high'
    ])
  })
})

describe('nearestThinkingOption', () => {
  const options = ['default', 'none', 'low', 'medium', 'high', 'max'] as const

  it('keeps an in-vocabulary value', () => {
    expect(nearestThinkingOption('medium', options)).toBe('medium')
  })

  it("maps the legacy 'xhigh' alias onto the adjacent native tier", () => {
    expect(nearestThinkingOption('xhigh', options)).toBe('max')
  })

  it('breaks distance ties upward (minimal → low, not none)', () => {
    expect(nearestThinkingOption('minimal', options)).toBe('low')
  })

  it('falls back to the first selectable option for unknown values', () => {
    expect(nearestThinkingOption('ultra', options)).toBe('none')
  })

  it("never returns 'default'", () => {
    expect(nearestThinkingOption('high', ['default', 'high'])).toBe('high')
  })
})
