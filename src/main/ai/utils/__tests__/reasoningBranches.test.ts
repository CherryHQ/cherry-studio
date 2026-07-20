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
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import {
  getAnthropicReasoningParams,
  getBedrockReasoningParams,
  getGeminiReasoningParams,
  getOllamaReasoningParams,
  getOpenAIReasoningParams,
  getReasoningEffort
} from '../reasoning'

const provider = (id: string) => ({ id, name: id }) as Provider

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

const withEfforts = (...supportedEfforts: RuntimeReasoning['supportedEfforts']): RuntimeReasoning => ({
  type: '',
  supportedEfforts
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

/** Tower call with the generic custom provider unless a specific one matters. */
const tower = (p: string, m: Model, effort?: string, maxTokens?: number) =>
  getReasoningEffort(a(effort, maxTokens), m, provider(p))

describe('getReasoningEffort — legacy tower branch literals', () => {
  it('skips groq entirely', () => {
    expect(tower('groq', model('groq', 'glm-4.5', withLimits(0, 30_720)), 'high')).toEqual({})
  })

  it('skips non-reasoning models', () => {
    const m = model('my-custom', 'gpt-4.1')
    ;(m as { capabilities: string[] }).capabilities = []
    expect(tower('my-custom', m, 'high')).toEqual({})
  })

  it('forces medium for OpenAI deep research even with no effort set', () => {
    expect(tower('openai', model('openai', 'o3-deep-research'))).toEqual({ reasoning_effort: 'medium' })
  })

  it("returns {} for 'default'", () => {
    expect(tower('my-custom', model('my-custom', 'claude-sonnet-4-5', withLimits(1024, 64_000)), 'default')).toEqual({})
  })

  describe("'none' (explicit off)", () => {
    it('openrouter + gpt-5.1 → reasoning.effort none', () => {
      expect(tower('openrouter', model('openrouter', 'gpt-5.1'), 'none')).toEqual({ reasoning: { effort: 'none' } })
    })

    it('openrouter + other models → enabled:false + exclude', () => {
      expect(tower('openrouter', model('openrouter', 'claude-sonnet-4-5'), 'none')).toEqual({
        reasoning: { enabled: false, exclude: true }
      })
    })

    it('nvidia + qwen → chat_template_kwargs.enable_thinking false', () => {
      expect(tower('nvidia', model('nvidia', 'qwen3-32b', withLimits(1024, 38_912)), 'none')).toEqual({
        chat_template_kwargs: { enable_thinking: false }
      })
    })

    it('nvidia + deepseek hybrid → chat_template_kwargs.thinking false', () => {
      expect(tower('nvidia', model('nvidia', 'deepseek-v3.1'), 'none')).toEqual({
        chat_template_kwargs: { thinking: false }
      })
    })

    it('dashscope + deepseek hybrid → enable_thinking false', () => {
      expect(tower('dashscope', model('dashscope', 'deepseek-v3.1'), 'none')).toEqual({ enable_thinking: false })
    })

    it('silicon + zhipu → enable_thinking false', () => {
      expect(tower('silicon', model('silicon', 'glm-4.6', withLimits(0, 30_720)), 'none')).toEqual({
        enable_thinking: false
      })
    })

    it('together → reasoning.enabled false', () => {
      expect(tower('together', model('together', 'acme-reasoner-v1'), 'none')).toEqual({
        reasoning: { enabled: false }
      })
    })

    it('gemini flash (compat) → zero thinking budget', () => {
      expect(tower('my-custom', model('my-custom', 'gemini-2.5-flash', withLimits(0, 24_576)), 'none')).toEqual({
        extra_body: { google: { thinking_config: { thinking_budget: 0 } } }
      })
    })

    it('gemini pro (compat) cannot disable → {}', () => {
      expect(tower('my-custom', model('my-custom', 'gemini-2.5-pro', withLimits(128, 32_768)), 'none')).toEqual({})
    })

    it('doubao thinking SKU → thinking disabled', () => {
      expect(tower('my-custom', model('my-custom', 'doubao-seed-1-6-250615', withLimits(0, 30_720)), 'none')).toEqual({
        thinking: { type: 'disabled' }
      })
    })

    it('cerebras + zhipu → disable_reasoning', () => {
      expect(tower('cerebras', model('cerebras', 'glm-4.6', withLimits(0, 30_720)), 'none')).toEqual({
        disable_reasoning: true
      })
    })

    it('deepseek v4 → thinking disabled', () => {
      expect(tower('my-custom', model('my-custom', 'deepseek-v4'), 'none')).toEqual({ thinking: { type: 'disabled' } })
    })

    it('deepseek v3.x hybrid → {} (non-thinking is the default)', () => {
      expect(tower('my-custom', model('my-custom', 'deepseek-v3.1'), 'none')).toEqual({})
    })

    it('gpt-5.1+ → reasoningEffort none', () => {
      expect(tower('my-custom', model('my-custom', 'gpt-5.1'), 'none')).toEqual({ reasoningEffort: 'none' })
    })

    it('qwen 3.5 → chat_template_kwargs.enable_thinking false', () => {
      expect(tower('my-custom', model('my-custom', 'qwen3.5-397b-a17b'), 'none')).toEqual({
        chat_template_kwargs: { enable_thinking: false }
      })
    })

    it('mistral-small-2603 → reasoningEffort none', () => {
      expect(tower('my-custom', model('my-custom', 'mistral-small-2603'), 'none')).toEqual({
        reasoningEffort: 'none'
      })
    })
  })

  describe('poe (extra_body wrappers)', () => {
    it('openai models → extra_body.reasoning_effort (auto coerced to medium)', () => {
      expect(tower('poe', model('poe', 'gpt-5'), 'auto')).toEqual({ extra_body: { reasoning_effort: 'medium' } })
      expect(tower('poe', model('poe', 'gpt-5'), 'high')).toEqual({ extra_body: { reasoning_effort: 'high' } })
    })

    it('claude models → extra_body.thinking_budget clamped by default maxTokens', () => {
      // budget = floor((64000-1024)*.8+1024) = 51404 → clamp floor(min(51404, 8192*.8)) = 6553
      expect(tower('poe', model('poe', 'claude-sonnet-4-5', withLimits(1024, 64_000)), 'high')).toEqual({
        extra_body: { thinking_budget: 6553 }
      })
    })

    it('gemini models → extra_body.thinking_budget (auto → -1)', () => {
      expect(tower('poe', model('poe', 'gemini-2.5-flash', withLimits(0, 24_576)), 'high')).toEqual({
        extra_body: { thinking_budget: 19_660 }
      })
      expect(tower('poe', model('poe', 'gemini-2.5-flash', withLimits(0, 24_576)), 'auto')).toEqual({
        extra_body: { thinking_budget: -1 }
      })
    })

    it('unknown reasoning models → {} (dropped with a warning)', () => {
      expect(tower('poe', model('poe', 'acme-reasoner-v1'), 'high')).toEqual({})
    })
  })

  describe('openrouter (effort set)', () => {
    it('grok-4-fast → enabled only, effort ignored', () => {
      expect(tower('openrouter', model('openrouter', 'grok-4-fast'), 'high')).toEqual({
        reasoning: { enabled: true }
      })
    })

    it('effort-capable models → reasoning.effort (auto coerced to medium)', () => {
      const m = model('openrouter', 'claude-sonnet-4-5', withEfforts('low', 'medium', 'high'))
      expect(tower('openrouter', m, 'high')).toEqual({ reasoning: { effort: 'high' } })
      expect(tower('openrouter', m, 'auto')).toEqual({ reasoning: { effort: 'medium' } })
    })
  })

  describe('nvidia (chat_template_kwargs)', () => {
    it('qwen with knob → enable_thinking + budget', () => {
      // floor((38912-1024)*.8+1024) = 31334
      expect(tower('nvidia', model('nvidia', 'qwen3-32b', withLimits(1024, 38_912)), 'high')).toEqual({
        chat_template_kwargs: { enable_thinking: true, thinking_budget: 31_334 }
      })
    })

    it('always-think qwen → budget only (via the generic qwen branch)', () => {
      // always-think SKUs are excluded from the nvidia branch's qwen check and
      // land in the generic qwen branch, which routes nvidia to chat_template_kwargs.
      expect(tower('nvidia', model('nvidia', 'qwen3-235b-a22b-thinking-2507'), 'high')).toEqual({
        chat_template_kwargs: { thinking_budget: 65_536 }
      })
    })

    it('deepseek hybrid → thinking true', () => {
      expect(tower('nvidia', model('nvidia', 'deepseek-v3.1'), 'high')).toEqual({
        chat_template_kwargs: { thinking: true }
      })
    })

    it('kimi with knob → thinking true', () => {
      expect(tower('nvidia', model('nvidia', 'kimi-k2.5', withLimits(0, 30_720)), 'high')).toEqual({
        chat_template_kwargs: { thinking: true }
      })
    })

    it('zhipu with knob → enable_thinking true', () => {
      expect(tower('nvidia', model('nvidia', 'glm-4.6', withLimits(0, 30_720)), 'high')).toEqual({
        chat_template_kwargs: { enable_thinking: true }
      })
    })
  })

  describe('silicon (enable_thinking + 32768 budget floor)', () => {
    it('applies the hard budget floor', () => {
      // qwen3-32b budget 31334 < 32768 → floored up
      expect(tower('silicon', model('silicon', 'qwen3-32b', withLimits(1024, 38_912)), 'high')).toEqual({
        enable_thinking: true,
        thinking_budget: 32_768
      })
    })

    it('deepseek hybrid without token-map entry → no budget', () => {
      expect(tower('silicon', model('silicon', 'deepseek-v3.1'), 'medium')).toEqual({ enable_thinking: true })
    })
  })

  describe('deepseek v4+', () => {
    it('xhigh maps to max, everything else to high (silent coercion, frozen)', () => {
      const m = model('deepseek', 'deepseek-v4')
      expect(tower('deepseek', m, 'xhigh')).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'max' })
      expect(tower('deepseek', m, 'high')).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'high' })
      expect(tower('deepseek', m, 'low')).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'high' })
    })
  })

  describe('deepseek v3.x hybrid (per-provider thinking switch)', () => {
    const m = (p: string) => model(p, 'deepseek-v3.1')

    it('dashscope → enable_thinking + incremental_output', () => {
      expect(tower('dashscope', m('dashscope'), 'high')).toEqual({ enable_thinking: true, incremental_output: true })
    })

    it('cherryin/new-api → extra_body.thinking enabled', () => {
      expect(tower('cherryin', m('cherryin'), 'high')).toEqual({ extra_body: { thinking: { type: 'enabled' } } })
    })

    it('ppio family → thinking enabled', () => {
      expect(tower('ppio', m('ppio'), 'high')).toEqual({ thinking: { type: 'enabled' } })
    })

    it('together → reasoning.enabled', () => {
      expect(tower('together', m('together'), 'high')).toEqual({ reasoning: { enabled: true } })
    })

    it('unknown provider → thinking enabled (warned fallback)', () => {
      expect(tower('my-custom', m('my-custom'), 'high')).toEqual({ thinking: { type: 'enabled' } })
    })
  })

  it('dashscope + qwen → enable_thinking + budget from the regex token map', () => {
    expect(tower('dashscope', model('dashscope', 'qwen-plus'), 'high')).toEqual({
      enable_thinking: true,
      thinking_budget: 65_536
    })
  })

  it('together remaps efforts (minimal→low, xhigh→high, auto→medium) — frozen coercion', () => {
    const m = model('together', 'glm-4.5', withLimits(0, 30_720))
    expect(tower('together', m, 'minimal')).toEqual({ reasoningEffort: 'low', reasoning: { enabled: true } })
    expect(tower('together', m, 'xhigh')).toEqual({ reasoningEffort: 'high', reasoning: { enabled: true } })
    expect(tower('together', m, 'auto')).toEqual({ reasoningEffort: 'medium', reasoning: { enabled: true } })
  })

  describe('qwen (enable_thinking vs chat_template_kwargs)', () => {
    it('enable_thinking providers → flat fields', () => {
      expect(tower('my-custom', model('my-custom', 'qwen-plus'), 'high')).toEqual({
        enable_thinking: true,
        thinking_budget: 65_536
      })
    })

    it('always-think SKU omits the toggle', () => {
      expect(tower('my-custom', model('my-custom', 'qwen3-235b-a22b-thinking-2507'), 'high')).toEqual({
        thinking_budget: 65_536
      })
    })

    it('ollama → chat_template_kwargs', () => {
      expect(tower('ollama', model('ollama', 'qwen-plus'), 'high')).toEqual({
        chat_template_kwargs: { enable_thinking: true, thinking_budget: 65_536 }
      })
    })
  })

  it('hunyuan with knob → enable_thinking only', () => {
    expect(tower('hunyuan', model('hunyuan', 'hunyuan-a13b', withLimits(0, 30_720)), 'high')).toEqual({
      enable_thinking: true
    })
  })

  describe('reasoningEffort vocabulary branch (descriptor-driven)', () => {
    it('honors a supported effort', () => {
      expect(tower('my-custom', model('my-custom', 'o3', withEfforts('low', 'medium', 'high')), 'high')).toEqual({
        reasoningEffort: 'high'
      })
    })

    it('silently coerces an unsupported effort to the first option — frozen', () => {
      expect(tower('my-custom', model('my-custom', 'o3', withEfforts('low', 'medium', 'high')), 'xhigh')).toEqual({
        reasoningEffort: 'low'
      })
      expect(tower('my-custom', model('my-custom', 'grok-3-mini', withEfforts('low', 'high')), 'medium')).toEqual({
        reasoningEffort: 'low'
      })
    })
  })

  it('mistral-small-2603 → always high when enabled', () => {
    expect(tower('my-custom', model('my-custom', 'mistral-small-2603'), 'low')).toEqual({ reasoningEffort: 'high' })
  })

  describe('gemini (openai-compat)', () => {
    it('gemini 3 → plain reasoningEffort (auto passes through)', () => {
      const m = model('my-custom', 'gemini-3-flash', withLimits(0, 24_576))
      expect(tower('my-custom', m, 'high')).toEqual({ reasoningEffort: 'high' })
      expect(tower('my-custom', m, 'auto')).toEqual({ reasoningEffort: 'auto' })
    })

    it('gemini 2.x → extra_body.google.thinking_config with budget', () => {
      const m = model('my-custom', 'gemini-2.5-flash', withLimits(0, 24_576))
      expect(tower('my-custom', m, 'high')).toEqual({
        extra_body: { google: { thinking_config: { thinking_budget: 19_660, include_thoughts: true } } }
      })
      expect(tower('my-custom', m, 'auto')).toEqual({
        extra_body: { google: { thinking_config: { thinking_budget: -1, include_thoughts: true } } }
      })
    })
  })

  it('claude (openai-compat) → thinking with clamped budget_tokens', () => {
    expect(tower('my-custom', model('my-custom', 'claude-sonnet-4-5', withLimits(1024, 64_000)), 'high')).toEqual({
      thinking: { type: 'enabled', budget_tokens: 6553 }
    })
  })

  describe('doubao', () => {
    it('auto-capable SKU: high → enabled, auto → auto, low → {}', () => {
      const m = model('doubao', 'doubao-seed-1-6-250615', withLimits(0, 30_720))
      expect(tower('doubao', m, 'high')).toEqual({ thinking: { type: 'enabled' } })
      expect(tower('doubao', m, 'auto')).toEqual({ thinking: { type: 'auto' } })
      expect(tower('doubao', m, 'low')).toEqual({})
    })

    it('251015+ SKUs → plain reasoningEffort', () => {
      const m = model('doubao', 'doubao-seed-1-6-251015', withLimits(0, 30_720))
      expect(tower('doubao', m, 'low')).toEqual({ reasoningEffort: 'low' })
    })
  })

  describe('thinking-type family (zhipu / kimi / mimo)', () => {
    it('zhipu with knob → thinking enabled (suppressed on cerebras)', () => {
      expect(tower('my-custom', model('my-custom', 'glm-4.6', withLimits(0, 30_720)), 'high')).toEqual({
        thinking: { type: 'enabled' }
      })
      expect(tower('cerebras', model('cerebras', 'glm-4.6', withLimits(0, 30_720)), 'high')).toEqual({})
    })

    it('kimi / mimo with knob → thinking enabled', () => {
      expect(tower('my-custom', model('my-custom', 'kimi-k2.5', withLimits(0, 30_720)), 'high')).toEqual({
        thinking: { type: 'enabled' }
      })
      expect(tower('my-custom', model('my-custom', 'mimo-v2-flash', withLimits(0, 30_720)), 'high')).toEqual({
        thinking: { type: 'enabled' }
      })
    })
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

    it('deepseek v4 over the claude wire → effort verbatim (max ≠ xhigh), no fabricated budget', () => {
      const v4 = model(
        'my-custom',
        'deepseek-v4',
        withControls([{ kind: 'effort', values: ['none', 'high', 'max', 'xhigh'] }, { kind: 'toggle' }])
      )
      expect(getAnthropicReasoningParams(a('max'), v4)).toEqual({
        thinking: { type: 'enabled' },
        sendReasoning: true,
        effort: 'max'
      })
      expect(getAnthropicReasoningParams(a('xhigh'), v4)).toEqual({
        thinking: { type: 'enabled' },
        sendReasoning: true,
        effort: 'xhigh'
      })
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

    it('descriptor-less compat model → enabled envelope only (no fabricated budget)', () => {
      expect(getAnthropicReasoningParams(a('high'), model('my-custom', 'kimi-k2.5'))).toEqual({
        thinking: { type: 'enabled' },
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
