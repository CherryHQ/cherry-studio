/**
 * Reasoning contracts shared by the two DashScope-backed providers (`dashscope` China / `qwencloud`
 * international) — the wire vocabulary is one platform family, so it must not fork between hosts.
 */
import type { ReasoningSupport } from '../schemas/model'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { EFFORT, modeWire } from './wires'

/**
 * Bailian/QwenCloud Chat `thinking_budget` ceilings differ per SKU family
 * (#21906): qwen3.5 lines cap at 81920, qwen3.6 plus/flash lines at 131072.
 * The wire `max` is the provider-side backstop for descriptors that are
 * missing or wider than Bailian accepts; `resolveModeBudget` clamps to
 * `min(policy.max, thinkingTokenLimits.max)`.
 */
const qwenChatWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'enable_thinking', value: { source: 'literal', value: false } }] },
  auto: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'thinking_budget', value: { source: 'budget' } }
    ],
    budget: { max: 81920, missing: { type: 'omit-value' } }
  },
  effort: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'thinking_budget', value: { source: 'budget' } }
    ],
    budget: { max: 81920, missing: { type: 'omit-value' } }
  }
}

/**
 * Vendor ids served on the 128K thinking-budget wire (#21906). Suffix-closed
 * (`(?:-|$)`) so dated snapshots (`qwen3.6-plus-2026-04-02`, …) resolve to
 * the same wire as their base SKU while hypothetical `plusfoo`-style
 * siblings cannot mis-bucket into the 128K tier — mirroring the creator
 * budget rule, which carries the same closer.
 */
const QWEN_128K_CHAT_MODEL_PATTERN = /^qwen3[.-]6-(?:plus|flash|max-preview)(?:-|$)/
function isQwen128kChatModel(apiModelId: string): boolean {
  return QWEN_128K_CHAT_MODEL_PATTERN.test(apiModelId)
}

/** Qwen3.6 plus/flash SKUs accept up to 131072 (128K) thinking tokens. */
const qwenChatWire128k: ReasoningWireProfile = {
  off: { operations: [{ target: 'enable_thinking', value: { source: 'literal', value: false } }] },
  auto: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'thinking_budget', value: { source: 'budget' } }
    ],
    budget: { max: 131072, missing: { type: 'omit-value' } }
  },
  effort: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'thinking_budget', value: { source: 'budget' } }
    ],
    budget: { max: 131072, missing: { type: 'omit-value' } }
  }
}

const qwen38Support: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'xhigh'], default: 'xhigh' }],
  defaultEffort: 'xhigh',
  supportedEfforts: ['none', 'low', 'medium', 'xhigh'],
  // No thinking_budget on Qwen3.8; limits let the gateway reverse a budget into the nearest tier.
  thinkingTokenLimits: { min: 0, max: 262_144 }
}

/** `qwen3.8-max-preview` serves thinking mode only — no `'none'` tier, so reasoning cannot be disabled. */
const qwen38PreviewSupport: ReasoningSupport = {
  ...qwen38Support,
  controls: [{ kind: 'effort', values: ['low', 'medium', 'xhigh'], default: 'xhigh' }],
  supportedEfforts: ['low', 'medium', 'xhigh']
}

/** DeepSeek-V4 / GLM lines on DashScope take a `high`/`max` effort instead of Qwen's tiers. */
const highMaxSupport: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'high', 'max'], default: 'high' }],
  defaultEffort: 'high',
  supportedEfforts: ['none', 'high', 'max']
}

/** Kimi K3 on DashScope exposes a single `max` effort tier. */
const kimiK3Support: ReasoningSupport = {
  controls: [{ kind: 'effort', values: ['none', 'max'], default: 'max' }],
  defaultEffort: 'max',
  supportedEfforts: ['none', 'max']
}

const effortChatWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'enable_thinking', value: { source: 'literal', value: false } }] },
  // `enable_thinking` outranks `reasoning_effort` (docs), so pin it explicitly instead of
  // relying on the models' thinking-on default.
  effort: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'reasoning_effort', value: { source: 'effort' } }
    ]
  }
}

const qwen38ChatWire: ReasoningWireProfile = modeWire('reasoning_effort', { off: 'none', effort: EFFORT })

// Preview variants omit the off mode entirely: thinking is always on there.
const qwen38PreviewChatWire: ReasoningWireProfile = modeWire('reasoning_effort', { effort: EFFORT })

export {
  effortChatWire,
  highMaxSupport,
  isQwen128kChatModel,
  kimiK3Support,
  qwen38ChatWire,
  qwen38PreviewChatWire,
  qwen38PreviewSupport,
  qwen38Support,
  qwenChatWire,
  qwenChatWire128k
}
