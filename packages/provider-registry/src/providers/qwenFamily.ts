/**
 * Reasoning contracts shared by the two DashScope-backed providers (`dashscope` China / `qwencloud`
 * international) — the wire vocabulary is one platform family, so it must not fork between hosts.
 */
import type { ReasoningSupport } from '../schemas/model'
import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { EFFORT, modeWire } from './wires'

const qwenChatWire: ReasoningWireProfile = {
  off: { operations: [{ target: 'enable_thinking', value: { source: 'literal', value: false } }] },
  auto: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'thinking_budget', value: { source: 'budget' } }
    ],
    budget: { missing: { type: 'omit-value' } }
  },
  effort: {
    operations: [
      { target: 'enable_thinking', value: { source: 'literal', value: true } },
      { target: 'thinking_budget', value: { source: 'budget' } }
    ],
    budget: { missing: { type: 'omit-value' } }
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
  effort: { operations: [{ target: 'reasoning_effort', value: { source: 'effort' } }] }
}

const qwen38ChatWire: ReasoningWireProfile = modeWire('reasoning_effort', { off: 'none', effort: EFFORT })

// Preview variants omit the off mode entirely: thinking is always on there.
const qwen38PreviewChatWire: ReasoningWireProfile = modeWire('reasoning_effort', { effort: EFFORT })

export {
  effortChatWire,
  highMaxSupport,
  kimiK3Support,
  qwen38ChatWire,
  qwen38PreviewChatWire,
  qwen38PreviewSupport,
  qwen38Support,
  qwenChatWire
}
