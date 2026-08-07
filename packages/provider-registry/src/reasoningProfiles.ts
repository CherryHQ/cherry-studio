import type { ReasoningEffort } from './schemas/enums'
import type { ReasoningWireDialect } from './schemas/model'
import type { ReasoningFormatType } from './schemas/provider'
import type {
  ReasoningFormatWireProfile,
  ReasoningWireOperation,
  ReasoningWireProfile,
  ReasoningWireTarget,
  ReasoningWireValue
} from './schemas/reasoningWire'

type NonBudgetOperation = Omit<ReasoningWireOperation, 'value'> & {
  value: Exclude<ReasoningWireValue, { source: 'budget' }>
}

type NonBudgetMode = {
  operations: NonBudgetOperation[]
  effortMap?: Partial<Record<ReasoningEffort, ReasoningEffort>>
}

const literal = (target: ReasoningWireTarget, value: string | number | boolean): NonBudgetOperation => ({
  target,
  value: { source: 'literal', value }
})

const effort = (target: ReasoningWireTarget): NonBudgetOperation => ({
  target,
  value: { source: 'effort' }
})

const summary = (target: ReasoningWireTarget): NonBudgetOperation => ({
  target,
  value: { source: 'assistant-summary' }
})

const mode = (operations: NonBudgetOperation[], rest: Omit<NonBudgetMode, 'operations'> = {}): NonBudgetMode => ({
  operations,
  ...rest
})

/** Budget-dialect operation — writes the resolved thinking-token count. */
const budgetTokens = (target: ReasoningWireTarget): ReasoningWireOperation => ({
  target,
  value: { source: 'budget' }
})

/**
 * Gemini 2.x budget dialect: `thinkingBudget` in tokens (0 = off, -1 = dynamic).
 * These models hard-reject the Gemini 3 `thinkingLevel` field, so every provider
 * proxying them over `google-generate-content` lands here via `wireDialect`.
 */
const geminiBudgetWire: ReasoningWireProfile = {
  off: mode([literal('thinkingConfig.includeThoughts', false), literal('thinkingConfig.thinkingBudget', 0)]),
  auto: mode([literal('thinkingConfig.includeThoughts', true), literal('thinkingConfig.thinkingBudget', -1)]),
  effort: {
    operations: [literal('thinkingConfig.includeThoughts', true), budgetTokens('thinkingConfig.thinkingBudget')],
    budget: { missing: { type: 'fallback', value: -1 } }
  }
}

/**
 * Claude <=4.5 budget dialect: `thinking.type=enabled` + `budget_tokens`.
 * `adaptive` is 4.6+, so pre-adaptive SKUs resolve here. `auto` and `effort` are
 * deliberately identical — the dialect has no effort knob on the wire, so a
 * selected effort tier is expressed purely as a token budget.
 */
const anthropicEnabledBudget = {
  operations: [
    literal('thinking.type', 'enabled'),
    budgetTokens('thinking.budgetTokens'),
    literal('sendReasoning', true)
  ],
  budget: { missing: { type: 'fallback' as const, value: 13_312 }, clampToMaxTokens: true }
}

const anthropicBudgetWire: ReasoningWireProfile = {
  off: mode([literal('thinking.type', 'disabled')]),
  auto: anthropicEnabledBudget,
  effort: anthropicEnabledBudget
}

/**
 * Self-hosted (vLLM / SGLang) reasoning dialect. Chat-template servers like
 * Qwen3 and Hunyuan T1/A13B gate thinking through `chat_template_kwargs`:
 * `enable_thinking` turns it on/off and `thinking_budget` caps the thinking
 * tokens. The wire is endpoint-wide and static, so it cannot distinguish the
 * always-think Qwen SKUs the legacy path special-cased — modern vLLM treats a
 * redundant `enable_thinking: true` as a no-op and tolerates an unused
 * `thinking_budget`, so one wire covers both families.
 */
const selfHostedThinkingMode = {
  operations: [
    literal('chat_template_kwargs.enable_thinking', true),
    budgetTokens('chat_template_kwargs.thinking_budget')
  ],
  budget: { missing: { type: 'fallback' as const, value: 4096 } }
}

const selfHostedWire: ReasoningWireProfile = {
  off: mode([literal('chat_template_kwargs.enable_thinking', false)]),
  auto: selfHostedThinkingMode,
  effort: selfHostedThinkingMode
}

const genericEffort = (summaryTarget?: ReasoningWireTarget): ReasoningWireProfile => {
  const suffix = summaryTarget ? [summary(summaryTarget)] : []
  return {
    off: mode([literal('reasoningEffort', 'none'), ...suffix]),
    auto: mode([effort('reasoningEffort'), ...suffix], { effortMap: { auto: 'medium' } }),
    effort: mode([effort('reasoningEffort'), ...suffix])
  }
}

const formatProfiles = {
  'openai-chat': {
    wire: genericEffort()
  },
  'openai-responses': {
    wire: genericEffort('reasoningSummary')
  },
  anthropic: {
    wire: {
      off: mode([literal('thinking.type', 'disabled')]),
      auto: mode([literal('thinking.type', 'adaptive'), literal('thinking.display', 'summarized')]),
      effort: mode(
        [literal('thinking.type', 'adaptive'), literal('thinking.display', 'summarized'), effort('effort')],
        { effortMap: { minimal: 'low' } }
      )
    },
    budgetWire: anthropicBudgetWire
  },
  gemini: {
    wire: {
      off: mode([literal('thinkingConfig.includeThoughts', false), literal('thinkingConfig.thinkingLevel', 'minimal')]),
      auto: mode([literal('thinkingConfig.includeThoughts', true)]),
      effort: mode([literal('thinkingConfig.includeThoughts', true), effort('thinkingConfig.thinkingLevel')])
    },
    budgetWire: geminiBudgetWire
  },
  ollama: {
    wire: {
      off: mode([literal('think', false)]),
      auto: mode([literal('think', true)]),
      effort: mode([effort('think')])
    }
  },
  'self-hosted': {
    wire: selfHostedWire
  },
  none: {
    wire: { disabled: true }
  }
} as const satisfies Record<ReasoningFormatType, ReasoningFormatWireProfile>

export const REASONING_FORMAT_PROFILES: Record<ReasoningFormatType, ReasoningFormatWireProfile> = formatProfiles

/**
 * Pick the wire a model's generation speaks. Only a `budget` dialect on a format
 * that declares `budgetWire` diverges; everything else — including an undeclared
 * dialect — keeps the format's primary wire, so formats with a single dialect
 * and models with no declaration behave exactly as before.
 */
export function selectFormatWire(
  profile: ReasoningFormatWireProfile,
  dialect: ReasoningWireDialect | undefined
): ReasoningWireProfile {
  return dialect === 'budget' && profile.budgetWire ? profile.budgetWire : profile.wire
}
