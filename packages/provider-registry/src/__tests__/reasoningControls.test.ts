import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { inferReasoningControls } from '../patterns/reasoning-heuristics'
import { REASONING_EFFORT, REASONING_EFFORT_ORDER } from '../schemas/enums'
import type { ReasoningControl } from '../schemas/model'
import { ReasoningSupportSchema } from '../schemas/model'
import { REASONING_FORMAT_TYPES } from '../schemas/provider'
import { deriveLegacyReasoningFields } from '../utils/reasoningControls'

describe('REASONING_EFFORT_ORDER', () => {
  it('is a permutation of REASONING_EFFORT (exhaustiveness lock)', () => {
    expect([...REASONING_EFFORT_ORDER].sort()).toEqual(Object.values(REASONING_EFFORT).sort())
  })
})

describe('REASONING_FORMAT_TYPES', () => {
  it('derives every discriminator from the format union', () => {
    expect(REASONING_FORMAT_TYPES).toEqual([
      'openai-chat',
      'openai-responses',
      'anthropic',
      'gemini',
      'openrouter',
      'enable-thinking',
      'thinking-type',
      'dashscope',
      'self-hosted',
      'none',
      'disable-reasoning'
    ])
  })
})

describe('deriveLegacyReasoningFields', () => {
  it('derives the vocabulary from an effort control', () => {
    expect(deriveLegacyReasoningFields([{ kind: 'effort', values: ['low', 'medium', 'high', 'max'] }])).toEqual({
      supportedEfforts: ['low', 'medium', 'high', 'max'],
      thinkingTokenLimits: undefined,
      defaultEffort: undefined
    })
  })

  it('derives token limits from a budget control', () => {
    expect(deriveLegacyReasoningFields([{ kind: 'budget', min: 1024, max: 64_000, default: 8192 }])).toEqual({
      supportedEfforts: undefined,
      thinkingTokenLimits: { min: 1024, max: 64_000, default: 8192 },
      defaultEffort: undefined
    })
  })

  it("maps a bare toggle to ['none', 'auto'] (the models.dev ingest rule)", () => {
    expect(deriveLegacyReasoningFields([{ kind: 'toggle' }])).toEqual({
      supportedEfforts: ['none', 'auto'],
      thinkingTokenLimits: undefined,
      defaultEffort: undefined
    })
  })

  it("a toggle next to an effort control appends 'none' (never index 0 — the legacy coercion fallback)", () => {
    expect(
      deriveLegacyReasoningFields([{ kind: 'effort', values: ['low', 'high'], default: 'low' }, { kind: 'toggle' }])
    ).toEqual({
      supportedEfforts: ['low', 'high', 'none'],
      thinkingTokenLimits: undefined,
      defaultEffort: 'low'
    })
  })

  it('combines effort + budget controls independently', () => {
    expect(
      deriveLegacyReasoningFields([
        { kind: 'effort', values: ['none', 'auto'] },
        { kind: 'budget', min: 0, max: 81_920 }
      ])
    ).toEqual({
      supportedEfforts: ['none', 'auto'],
      thinkingTokenLimits: { min: 0, max: 81_920 },
      defaultEffort: undefined
    })
  })
})

describe('inferReasoningControls (ingest-time heuristics)', () => {
  it.each([
    // [id, expected controls]
    ['gpt-5.1', [{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }]],
    ['gpt-5.2-pro', [{ kind: 'effort', values: ['medium', 'high', 'xhigh'] }]],
    ['o3', [{ kind: 'effort', values: ['low', 'medium', 'high'] }]],
    ['claude-sonnet-4-5', [{ kind: 'budget', min: 1024, max: 64_000 }, { kind: 'toggle' }]],
    [
      'claude-opus-4-6',
      [
        { kind: 'effort', values: ['low', 'medium', 'high', 'max'] },
        { kind: 'budget', min: 1024, max: 128_000 },
        { kind: 'toggle' }
      ]
    ],
    ['grok-4.3', [{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }]],
    ['deepseek-v4', [{ kind: 'effort', values: ['none', 'high', 'max'] }]],
    ['deepseek-v3.1', [{ kind: 'toggle' }]],
    ['qwen3-32b', [{ kind: 'budget', min: 1024, max: 38_912 }, { kind: 'toggle' }]],
    // always-think SKU: budget only, no toggle
    ['qwen3-235b-a22b-thinking-2507', [{ kind: 'budget', min: 0, max: 81_920 }]],
    [
      'doubao-seed-1-6-250615',
      [
        { kind: 'effort', values: ['none', 'auto', 'high'] },
        { kind: 'budget', min: 0, max: 30_720 }
      ]
    ],
    [
      'doubao-seed-1-6-251015',
      [
        { kind: 'effort', values: ['minimal', 'low', 'medium', 'high'] },
        { kind: 'budget', min: 0, max: 30_720 }
      ]
    ],
    ['glm-4.6', [{ kind: 'budget', min: 0, max: 30_720 }, { kind: 'toggle' }]],
    ['gemma-4-27b-it', [{ kind: 'effort', values: ['minimal', 'high'] }]],
    ['mistral-small-2603', [{ kind: 'effort', values: ['none', 'high'] }]],
    // provider-namespaced ids are normalized before matching
    ['deepseek/deepseek-v4', [{ kind: 'effort', values: ['none', 'high', 'max'] }]]
  ])('infers %s', (id, expected) => {
    expect(inferReasoningControls(id)).toEqual(expected)
  })

  it.each([
    'acme-reasoner-v1', // unknown family
    'deepseek-r1', // fixed reasoning — no knob
    'grok-4-fast', // the on/off knob is OpenRouter-only, not a model property
    'minimax-m2.1' // no documented knob
  ])('returns undefined for %s', (id) => {
    expect(inferReasoningControls(id)).toBeUndefined()
  })
})

describe('ReasoningSupportSchema control invariants', () => {
  it('rejects duplicate control kinds', () => {
    const r = ReasoningSupportSchema.safeParse({
      controls: [
        { kind: 'effort', values: ['low'] },
        { kind: 'effort', values: ['high'] }
      ]
    })
    expect(r.success).toBe(false)
  })

  it('rejects an effort default outside its values', () => {
    const r = ReasoningSupportSchema.safeParse({ controls: [{ kind: 'effort', values: ['low'], default: 'high' }] })
    expect(r.success).toBe(false)
  })

  it('rejects a budget default outside [min, max]', () => {
    const r = ReasoningSupportSchema.safeParse({ controls: [{ kind: 'budget', min: 100, max: 200, default: 300 }] })
    expect(r.success).toBe(false)
  })
})

describe('catalog invariant: controls ↔ derived legacy fields', () => {
  // Every shipped model that declares `controls` must carry EXACTLY the legacy
  // fields deriveLegacyReasoningFields produces — the generation normalization
  // pass guarantees it; this locks it against manual drift.
  const modelsPath = resolve(import.meta.dirname, '../../data/models.json')
  const { models } = JSON.parse(readFileSync(modelsPath, 'utf-8')) as {
    models: Array<{ id: string; reasoning?: { controls?: ReasoningControl[] } & Record<string, unknown> }>
  }

  // Key-order-insensitive (the shipped JSON is biome key-sorted).
  const canonical = (v: unknown): string =>
    JSON.stringify(v, (_, val) =>
      val && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
        : val
    )

  it('holds for every model with a controls declaration', () => {
    const offenders: string[] = []
    for (const m of models) {
      const controls = m.reasoning?.controls
      if (!controls?.length) continue
      const derived = deriveLegacyReasoningFields(controls)
      for (const [key, value] of Object.entries(derived)) {
        const actual = m.reasoning?.[key]
        if (canonical(actual ?? null) !== canonical(value ?? null)) {
          offenders.push(`${m.id}: ${key} = ${JSON.stringify(actual)} ≠ derived ${JSON.stringify(value)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
