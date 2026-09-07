import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PROVIDERS } from '../providers'
import { configureOpenAIResponsesSummary, REASONING_FORMAT_PROFILES, selectFormatWire } from '../reasoningProfiles'
import type { ModelConfig, ReasoningWireDialect } from '../schemas/model'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'

/**
 * The native-protocol dialect split (#17394 follow-up). Gemini 2.x rejects the
 * Gemini 3 `thinkingLevel` field and Claude <=4.5 rejects `thinking.type =
 * adaptive`, so the wrong dialect is a hard 400 — the failure that motivated
 * moving this from per-provider pins to a declared model fact.
 */
const models: ModelConfig[] = JSON.parse(readFileSync(join(__dirname, '../../data/models.json'), 'utf8')).models

const reasoningModels = (prefix: RegExp) => models.filter((m) => prefix.test(m.id) && m.reasoning)

const targetsOf = (wire: ReasoningWireProfile): string[] =>
  Object.values(wire).flatMap((mode) =>
    mode && typeof mode === 'object' && 'operations' in mode
      ? mode.operations.map((op: { target: string }) => op.target)
      : []
  )

describe('native-protocol reasoning dialect', () => {
  it.each([
    ['gemini', /^gemini/],
    ['claude', /^claude/]
  ])('declares a dialect for every %s reasoning model', (_label, prefix) => {
    const undeclared = reasoningModels(prefix)
      .filter((m) => !m.reasoning?.wireDialect)
      .map((m) => m.id)
    expect(undeclared).toEqual([])
  })

  // Ground truth: the exact set that carried a hand-pinned budget contract
  // before the dialect became data, plus gemini-robotics (a 2.x-era derivative
  // that was never pinned and had been taking the level wire by mistake).
  it.each([
    ['gemini-2-5-flash', 'budget'],
    ['gemini-2-5-pro', 'budget'],
    ['gemini-2-5-flash-lite', 'budget'],
    ['gemini-omni-flash-preview', 'budget'],
    ['gemini-robotics-er-1-6-preview', 'budget'],
    ['gemini-3-flash', 'effort'],
    // Both Nano Banana 2 variants are Gemini 3.1 and declare identical controls
    // (effort [minimal, high], no `none` — thinking can't be disabled), so they
    // must resolve alike. The old budget pin on -lite-image predated upstream
    // reporting its effort control; see the sibling assertion below.
    ['gemini-3-1-flash-image', 'effort'],
    ['gemini-3-1-flash-lite-image', 'effort'],
    ['gemini-3-1-pro-preview', 'effort'],
    ['gemini-flash-latest', 'effort'],
    ['claude-opus-4-5', 'budget'],
    ['claude-haiku-4-5', 'budget'],
    ['claude-sonnet-4-5', 'budget'],
    ['claude-opus-4-6', 'effort'],
    ['claude-opus-4-8', 'effort'],
    ['claude-fable-5', 'effort']
  ])('resolves %s to the %s dialect', (modelId, dialect) => {
    expect(models.find((m) => m.id === modelId)?.reasoning?.wireDialect).toBe(dialect)
  })

  // A dialect is a property of the model GENERATION, so two SKUs of the same
  // generation that declare identical controls must not disagree. Catches the
  // stale-pin class directly: -lite-image was pinned to budget back when
  // upstream reported no effort control for it, then upstream started
  // reporting the same controls as its non-lite sibling.
  it('gives same-generation siblings with identical controls the same dialect', () => {
    const byControls = new Map<string, { id: string; dialect?: string }[]>()
    for (const m of reasoningModels(/^gemini-3/)) {
      const key = JSON.stringify(m.reasoning?.controls)
      byControls.set(key, [...(byControls.get(key) ?? []), { id: m.id, dialect: m.reasoning?.wireDialect }])
    }
    const split = [...byControls.values()]
      .filter((group) => new Set(group.map((g) => g.dialect)).size > 1)
      .map((group) => group.map((g) => `${g.id}=${g.dialect}`).join(' vs '))
    expect(split).toEqual([])
  })

  // opus-4.5 takes an effort knob (output_config.effort) yet still speaks the
  // budget thinking dialect — the counterexample proving dialect is not
  // derivable from controls and must stay declared.
  it('keeps effort-capability and dialect independent for claude-opus-4-5', () => {
    const reasoning = models.find((m) => m.id === 'claude-opus-4-5')?.reasoning
    expect(reasoning?.controls?.some((c) => c.kind === 'effort')).toBe(true)
    expect(reasoning?.wireDialect).toBe('budget')
  })

  it.each([
    ['gemini', 'thinkingConfig.thinkingLevel'],
    ['anthropic', 'thinking.type=adaptive']
  ])('never emits the %s newer-generation field on the budget wire', (format) => {
    const wire = selectFormatWire(REASONING_FORMAT_PROFILES[format as 'gemini' | 'anthropic'], 'budget')
    expect(targetsOf(wire)).not.toContain('thinkingConfig.thinkingLevel')
    const literals = Object.values(wire).flatMap((mode) =>
      mode && typeof mode === 'object' && 'operations' in mode
        ? mode.operations.map((op: { value: { source: string; value?: unknown } }) => op.value.value)
        : []
    )
    expect(literals).not.toContain('adaptive')
  })

  it('selects the primary wire when no dialect is declared', () => {
    for (const format of ['gemini', 'anthropic'] as const) {
      const profile = REASONING_FORMAT_PROFILES[format]
      expect(selectFormatWire(profile, undefined)).toBe(profile.wire)
      expect(selectFormatWire(profile, 'effort')).toBe(profile.wire)
      expect(selectFormatWire(profile, 'budget')).toBe(profile.budgetWire)
    }
  })

  // Formats whose protocol has one dialect must ignore the declaration entirely,
  // so open-weight models on openai-compatible endpoints are untouched.
  it.each(['openai-chat', 'openai-responses', 'ollama', 'none'] as const)(
    'ignores the dialect for single-dialect format %s',
    (format) => {
      const profile = REASONING_FORMAT_PROFILES[format]
      expect(profile.budgetWire).toBeUndefined()
      for (const dialect of [undefined, 'effort', 'budget'] as (ReasoningWireDialect | undefined)[]) {
        expect(selectFormatWire(profile, dialect)).toBe(profile.wire)
      }
    }
  )

  it('leaves no provider hand-pinning a native-protocol dialect it now inherits', () => {
    const NATIVE = { 'google-generate-content': /thinkingConfig\./, 'anthropic-messages': /^thinking\./ }
    const leftovers: string[] = []
    for (const provider of PROVIDERS) {
      for (const override of provider.overrides ?? []) {
        for (const [endpoint, pattern] of Object.entries(NATIVE)) {
          const wire = override.reasoningContracts?.[endpoint as keyof typeof NATIVE]?.wire
          if (!wire) continue
          // aws-bedrock uses its own `reasoningConfig.*` namespace, and opencode
          // /mimo route non-Claude models over anthropic-messages with bespoke
          // budget policies — those are genuine provider variation, not dialect.
          if (targetsOf(wire).some((t) => pattern.test(t)) && /^(gemini|claude)/.test(override.modelId ?? '')) {
            leftovers.push(`${provider.id}/${override.modelId}/${endpoint}`)
          }
        }
      }
    }
    expect(leftovers).toEqual([])
  })
})

describe('OpenAI Responses summary compatibility', () => {
  it('adds and removes summary operations without changing the effort wire', () => {
    const base = REASONING_FORMAT_PROFILES['openai-responses'].wire
    const enabled = configureOpenAIResponsesSummary(base, true)
    const disabled = configureOpenAIResponsesSummary(enabled, false)

    expect(enabled.default?.operations).toContainEqual({
      target: 'reasoningSummary',
      value: { source: 'assistant-summary' }
    })
    expect(enabled.effort?.operations).toContainEqual({
      target: 'reasoningEffort',
      value: { source: 'effort' }
    })
    expect(targetsOf(disabled)).not.toContain('reasoningSummary')
    expect(disabled.default).toBeUndefined()
    expect(disabled.effort).toEqual(base.effort)
  })
})
