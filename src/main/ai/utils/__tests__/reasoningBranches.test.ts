/**
 * Branch-level characterization literals for the reasoning injection layer
 * (#16598) — one hand-verified `toEqual` per legacy-tower / native-fn branch.
 *
 * These literals were locked against the CURRENT implementation's output
 * (including its known warts: silent effort coercion, dead descriptor-gated
 * branches, the `auto` ratio-2 budget). They are the migration oracle:
 * Phase 4's serializer swap must keep them green; Phase 3 data changes that
 * move a case are reviewed as intentional golden updates.
 *
 * Budget arithmetic used below (from EFFORT_RATIO × THINKING_TOKEN_MAP):
 *   budget = floor((max - min) * ratio + min); ratios: low/minimal .05,
 *   medium .5, high .8, xhigh .9, auto 2. Claude compat additionally clamps
 *   to floor(max(1024, min(budget, (maxTokens ?? 8192) * ratio))).
 */
import type { Assistant } from '@shared/data/types/assistant'
import { createUniqueModelId, type Model, type RuntimeReasoning } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  getAnthropicReasoningParams,
  getBedrockReasoningParams,
  getGeminiReasoningParams,
  getOllamaReasoningParams,
  getOpenAIReasoningParams,
  getReasoningEffort
} from '../reasoning'

const model = (providerId: string, modelId: string, reasoning?: RuntimeReasoning): Model =>
  ({
    id: createUniqueModelId(providerId, modelId),
    providerId,
    apiModelId: modelId,
    name: modelId,
    capabilities: ['reasoning'],
    reasoning,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }) as Model

const withLimits = (min: number, max: number): RuntimeReasoning => ({
  type: '',
  supportedEfforts: [],
  thinkingTokenLimits: { min, max }
})

const withControls = (
  controls: NonNullable<RuntimeReasoning['controls']>,
  limits?: { min: number; max: number }
): RuntimeReasoning => ({
  type: '',
  supportedEfforts: [],
  controls,
  ...(limits ? { thinkingTokenLimits: limits } : {})
})

const a = (effort?: string, maxTokens?: number): Assistant =>
  ({ settings: { ...(effort !== undefined ? { reasoning_effort: effort } : {}), maxTokens } }) as Assistant

describe('getReasoningEffort — descriptor-less models get no params', () => {
  it('returns {} for a reasoning-capable model without a descriptor (fixed reasoner)', () => {
    // The legacy branch tower is gone: no descriptor = no knobs = nothing to
    // serialize. Fixed reasoners render knob-less in the UI, so effort values
    // can only be stale — they must not resurrect wire params.
    const provider = { id: 'openrouter', name: 'OpenRouter' } as never
    expect(getReasoningEffort(a('high'), model('openrouter', 'deepseek-r1'), provider)).toEqual({})
    expect(getReasoningEffort(a('none'), model('openrouter', 'deepseek-r1'), provider)).toEqual({})
    expect(getReasoningEffort(a(), model('dashscope', 'qwq-32b'), provider)).toEqual({})
  })

  it('still pins deep research to medium on the descriptor path head', () => {
    const provider = { id: 'openai', name: 'OpenAI' } as never
    const m = model('openai', 'o3-deep-research', {
      type: 'openai-responses',
      controls: [{ kind: 'effort', values: ['medium'] }],
      supportedEfforts: ['medium']
    })
    expect(getReasoningEffort(a('high'), m, provider)).toEqual({ reasoning_effort: 'medium' })
  })
})

describe('native adapter params — descriptor-driven (#16598)', () => {
  describe('getAnthropicReasoningParams', () => {
    const claude46 = model(
      'anthropic',
      'claude-opus-4-6',
      withControls([{ kind: 'effort', values: ['low', 'medium', 'high', 'max'] }, { kind: 'toggle' }], {
        min: 1024,
        max: 128_000
      })
    )

    it('adaptive generation → declared vocabulary verbatim, stale tiers to the nearest declared one', () => {
      expect(getAnthropicReasoningParams(a('high'), claude46)).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'high'
      })
      expect(getAnthropicReasoningParams(a('max'), claude46)).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'max'
      })
      // 4.6 declares no 'xhigh' — a stale persisted value lands on the nearest tier.
      expect(getAnthropicReasoningParams(a('xhigh'), claude46)).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'max'
      })
      expect(getAnthropicReasoningParams(a('minimal'), claude46)).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'low'
      })
      expect(getAnthropicReasoningParams(a('auto'), claude46)).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' }
      })
    })

    it('default IS auto — adaptive claude gets the explicit envelope, others send nothing', () => {
      expect(getAnthropicReasoningParams(a(), claude46)).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' }
      })
      // Pre-adaptive claude and compat models keep the bare default.
      expect(
        getAnthropicReasoningParams(a(), model('anthropic', 'claude-sonnet-4-5', withLimits(1024, 64_000)))
      ).toEqual({})
      expect(
        getAnthropicReasoningParams(
          a(),
          model('my-custom', 'deepseek-v4', withControls([{ kind: 'effort', values: ['none', 'high', 'max'] }]))
        )
      ).toEqual({})
    })

    it('post-4.7 generation (fable) → native xhigh rides verbatim', () => {
      const fable = model(
        'anthropic',
        'claude-fable-5',
        withControls([{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }, { kind: 'toggle' }])
      )
      expect(getAnthropicReasoningParams(a('xhigh'), fable)).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'xhigh'
      })
    })

    it('pre-4.6 claude (no effort control) → enabled + budgetTokens', () => {
      const m = model('anthropic', 'claude-sonnet-4-5', withLimits(1024, 64_000))
      // floor((64000-1024)*.8+1024) = 51404
      expect(getAnthropicReasoningParams(a('high'), m)).toEqual({
        thinking: { type: 'enabled', budgetTokens: 51_404 }
      })
      expect(getAnthropicReasoningParams(a('none'), m)).toEqual({ thinking: { type: 'disabled' } })
    })

    it('deepseek v4 over the claude wire → bare effort verbatim, no thinking envelope at all', () => {
      // DeepSeek's docs use output_config.effort alone; a budget-less
      // 'enabled' envelope would trigger the SDK's 1024-token backfill.
      const v4 = model(
        'my-custom',
        'deepseek-v4',
        withControls([{ kind: 'effort', values: ['none', 'high', 'max', 'xhigh'] }, { kind: 'toggle' }])
      )
      expect(getAnthropicReasoningParams(a('max'), v4)).toEqual({
        sendReasoning: true,
        effort: 'max'
      })
      expect(getAnthropicReasoningParams(a('xhigh'), v4)).toEqual({
        sendReasoning: true,
        effort: 'xhigh'
      })
      expect(getAnthropicReasoningParams(a('none'), v4)).toEqual({ thinking: { type: 'disabled' } })
    })

    it('compat model with declared budget (kimi-k3) → budget from the descriptor + effort verbatim', () => {
      const k3 = model(
        'my-custom',
        'kimi-k3',
        withControls([{ kind: 'effort', values: ['low', 'high', 'max'] }, { kind: 'toggle' }], { min: 0, max: 30_720 })
      )
      // floor(30720*.8) = 24576
      expect(getAnthropicReasoningParams(a('high'), k3)).toEqual({
        thinking: { type: 'enabled', budgetTokens: 24_576 },
        sendReasoning: true,
        effort: 'high'
      })
    })

    it('minimax m3 → adaptive/disabled wire, default IS auto (its anthropic surface defaults OFF)', () => {
      const m3 = model('minimax', 'minimax-m3', withControls([{ kind: 'toggle' }]))
      expect(getAnthropicReasoningParams(a(), m3)).toEqual({ thinking: { type: 'adaptive' }, sendReasoning: true })
      expect(getAnthropicReasoningParams(a('auto'), m3)).toEqual({
        thinking: { type: 'adaptive' },
        sendReasoning: true
      })
      expect(getAnthropicReasoningParams(a('none'), m3)).toEqual({ thinking: { type: 'disabled' } })
    })

    it('toggle/budget compat model → enabled + budget (fallback beats the SDK 1024 backfill)', () => {
      // kimi-k2.5 has no descriptor here; the enabled marker still needs a
      // valid budget on this wire. With no descriptor limits, use the
      // conservative fallback: floor((16384-1024)*.8+1024) = 13312.
      expect(getAnthropicReasoningParams(a('high'), model('my-custom', 'kimi-k2.5'))).toEqual({
        thinking: { type: 'enabled', budgetTokens: 13_312 },
        sendReasoning: true
      })
    })
  })

  describe('getGeminiReasoningParams', () => {
    it('gemini 2.x budget path → descriptor limits; hard-off only with a declared toggle', () => {
      const flash = model(
        'gemini',
        'gemini-2.5-flash',
        withControls([{ kind: 'toggle' }, { kind: 'budget', min: 0, max: 24_576 }], { min: 0, max: 24_576 })
      )
      expect(getGeminiReasoningParams(a('high'), flash)).toEqual({
        thinkingConfig: { includeThoughts: true, thinkingBudget: 19_660 }
      })
      expect(getGeminiReasoningParams(a('none'), flash)).toEqual({
        thinkingConfig: { includeThoughts: false, thinkingBudget: 0 }
      })

      // pro declares no toggle — off cannot force budget 0.
      const pro = model(
        'gemini',
        'gemini-2.5-pro',
        withControls([{ kind: 'budget', min: 128, max: 32_768 }], { min: 128, max: 32_768 })
      )
      expect(getGeminiReasoningParams(a('none'), pro)).toEqual({
        thinkingConfig: { includeThoughts: false }
      })
    })

    it('hosted gemma 4 → declared minimal/high vocabulary, thoughts only on high', () => {
      const m = model(
        'gemini',
        'gemma-4-27b-it',
        withControls([{ kind: 'effort', values: ['minimal', 'high'] }], { min: 1024, max: 30_720 })
      )
      expect(getGeminiReasoningParams(a('high'), m)).toEqual({
        thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' }
      })
      expect(getGeminiReasoningParams(a('low'), m)).toEqual({
        thinkingConfig: { includeThoughts: false, thinkingLevel: 'minimal' }
      })
    })

    it('default IS auto — dynamic thinking with visible thoughts', () => {
      const flash = model(
        'gemini',
        'gemini-2.5-flash',
        withControls([{ kind: 'toggle' }, { kind: 'budget', min: 0, max: 24_576 }], { min: 0, max: 24_576 })
      )
      expect(getGeminiReasoningParams(a(), flash)).toEqual({
        thinkingConfig: { includeThoughts: true, thinkingBudget: -1 }
      })
      const pro3 = model(
        'gemini',
        'gemini-3-pro-preview',
        withControls([{ kind: 'effort', values: ['low', 'high'] }], { min: 128, max: 32_768 })
      )
      expect(getGeminiReasoningParams(a(), pro3)).toEqual({ thinkingConfig: { includeThoughts: true } })
      // Hosted gemma keeps the bare default (no dynamic mode on that surface).
      const gemma = model(
        'gemini',
        'gemma-4-27b-it',
        withControls([{ kind: 'effort', values: ['minimal', 'high'] }], { min: 1024, max: 30_720 })
      )
      expect(getGeminiReasoningParams(a(), gemma)).toEqual({})
    })

    it('gemini 3 pro → none lands on the vocabulary floor (low)', () => {
      const m = model(
        'gemini',
        'gemini-3-pro-preview',
        withControls([{ kind: 'effort', values: ['low', 'high'] }], { min: 128, max: 32_768 })
      )
      expect(getGeminiReasoningParams(a('none'), m)).toEqual({
        thinkingConfig: { includeThoughts: false, thinkingLevel: 'low' }
      })
    })
  })

  describe('getOpenAIReasoningParams', () => {
    it('declared vocabulary verbatim; stale tiers to the nearest declared one', () => {
      const gpt5 = model(
        'openai',
        'gpt-5',
        withControls([{ kind: 'effort', values: ['minimal', 'low', 'medium', 'high'] }])
      )
      expect(getOpenAIReasoningParams(a('high'), gpt5, { summaryText: 'detailed' })).toEqual({
        reasoningEffort: 'high',
        reasoningSummary: 'detailed'
      })
      expect(getOpenAIReasoningParams(a('xhigh'), gpt5, { summaryText: 'detailed' })).toEqual({
        reasoningEffort: 'high',
        reasoningSummary: 'detailed'
      })
    })

    it("OFF never coerces to an ON tier — 'none' outside the vocabulary is omitted", () => {
      const oss = model('openai', 'gpt-oss-120b', withControls([{ kind: 'effort', values: ['low', 'medium', 'high'] }]))
      expect(getOpenAIReasoningParams(a('none'), oss)).toEqual({})

      const gpt51 = model(
        'openai',
        'gpt-5.1',
        withControls([{ kind: 'effort', values: ['none', 'low', 'medium', 'high'] }])
      )
      expect(getOpenAIReasoningParams(a('none'), gpt51, { summaryText: 'auto' })).toEqual({
        reasoningEffort: 'none',
        reasoningSummary: 'auto'
      })
    })

    it('non-openai models on responses endpoints → plain reasoningEffort', () => {
      expect(getOpenAIReasoningParams(a('high'), model('my-custom', 'kimi-k2.5'))).toEqual({
        reasoningEffort: 'high'
      })
    })
  })

  describe('getBedrockReasoningParams', () => {
    it('adaptive generation → declared vocabulary verbatim (SDK enum now carries xhigh)', () => {
      const m = model(
        'aws-bedrock',
        'claude-opus-4-7',
        withControls([{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }], { min: 1024, max: 128_000 })
      )
      expect(getBedrockReasoningParams(a('xhigh'), m)).toEqual({
        reasoningConfig: { type: 'adaptive', maxReasoningEffort: 'xhigh' }
      })
      expect(getBedrockReasoningParams(a('none'), m)).toEqual({ reasoningConfig: { type: 'disabled' } })
    })

    it('pre-4.6 claude → enabled + budgetTokens', () => {
      const m = model('aws-bedrock', 'claude-sonnet-4-5', withLimits(1024, 64_000))
      expect(getBedrockReasoningParams(a('high'), m)).toEqual({
        reasoningConfig: { type: 'enabled', budgetTokens: 51_404 }
      })
    })

    it('default IS auto — adaptive claude gets the bare adaptive config', () => {
      const m = model(
        'aws-bedrock',
        'claude-opus-4-7',
        withControls([{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }], { min: 1024, max: 128_000 })
      )
      expect(getBedrockReasoningParams(a(), m)).toEqual({ reasoningConfig: { type: 'adaptive' } })
      expect(
        getBedrockReasoningParams(a(), model('aws-bedrock', 'claude-sonnet-4-5', withLimits(1024, 64_000)))
      ).toEqual({})
    })
  })

  describe('getOllamaReasoningParams', () => {
    it('gpt-oss → declared string levels, stale tiers to the nearest one', () => {
      const m = model('ollama', 'gpt-oss-120b', withControls([{ kind: 'effort', values: ['low', 'medium', 'high'] }]))
      expect(getOllamaReasoningParams(a('high'), m)).toEqual({ think: 'high' })
      expect(getOllamaReasoningParams(a('xhigh'), m)).toEqual({ think: 'high' })
      expect(getOllamaReasoningParams(a('none'), m)).toEqual({ think: false })
    })

    it('other models → boolean think (unset defaults to true)', () => {
      expect(getOllamaReasoningParams(a(), model('ollama', 'qwen-plus'))).toEqual({ think: true })
      expect(getOllamaReasoningParams(a('none'), model('ollama', 'qwen-plus'))).toEqual({ think: false })
    })
  })
})
