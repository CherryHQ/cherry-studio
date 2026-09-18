import type { ReasoningEffort } from './schemas/enums'
import type { ReasoningWireDialect } from './schemas/model'
import type { ReasoningFormatType } from './schemas/provider'
import type {
  ReasoningFormatWireProfile,
  ReasoningWireMode,
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

const literal = (
  target: ReasoningWireTarget,
  value: string | number | boolean,
  delivery: ReasoningWireOperation['delivery'] = 'provider-option'
): NonBudgetOperation => ({
  target,
  value: { source: 'literal', value },
  delivery
})

const effort = (
  target: ReasoningWireTarget,
  delivery: ReasoningWireOperation['delivery'] = 'provider-option'
): NonBudgetOperation => ({
  target,
  value: { source: 'effort' },
  delivery
})

const summary = (
  target: ReasoningWireTarget,
  delivery: ReasoningWireOperation['delivery'] = 'provider-option'
): NonBudgetOperation => ({
  target,
  value: { source: 'assistant-summary' },
  delivery
})

const mode = (operations: NonBudgetOperation[], rest: Omit<NonBudgetMode, 'operations'> = {}): NonBudgetMode => ({
  operations,
  ...rest
})

/** Budget-dialect operation — writes the resolved thinking-token count. */
const budgetTokens = (
  target: ReasoningWireTarget,
  delivery: ReasoningWireOperation['delivery'] = 'provider-option'
): ReasoningWireOperation => ({
  target,
  value: { source: 'budget' },
  delivery
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
 * Self-hosted (vLLM / SGLang) reasoning wire. Chat-template servers gate
 * thinking through `chat_template_kwargs.enable_thinking` only; different
 * templates accept different budget fields, so a shared `thinking_budget`
 * with a 4096 fallback would send invalid or truncating params. Only the
 * toggle is generic — budget caps belong to a narrower format when needed.
 */
const selfHostedWire: ReasoningWireProfile = {
  off: mode([literal('chat_template_kwargs.enable_thinking', false, 'request-body')]),
  auto: mode([literal('chat_template_kwargs.enable_thinking', true, 'request-body')]),
  effort: mode([literal('chat_template_kwargs.enable_thinking', true, 'request-body')])
}

const genericEffort = (summaryTarget?: ReasoningWireTarget): ReasoningWireProfile => {
  const suffix = summaryTarget ? [summary(summaryTarget)] : []
  return {
    off: mode([literal('reasoningEffort', 'none'), ...suffix]),
    auto: mode([effort('reasoningEffort'), ...suffix], { effortMap: { auto: 'medium' } }),
    effort: mode([effort('reasoningEffort'), ...suffix])
  }
}

const REASONING_SUMMARY_OPERATIONS = [
  // A literal default the assistant setting overwrites when present — later operation wins.
  literal('reasoningSummary', 'auto'),
  summary('reasoningSummary')
] satisfies ReasoningWireOperation[]

function stripReasoningSummary(mode: ReasoningWireMode | undefined): ReasoningWireMode | undefined {
  if (!mode) return undefined
  const operations = mode.operations.filter((operation) => operation.target !== 'reasoningSummary')
  return operations.length > 0 ? ({ ...mode, operations } as ReasoningWireMode) : undefined
}

/** Apply a user's explicit compatibility choice to an OpenAI Responses wire. */
export function configureOpenAIResponsesSummary(profile: ReasoningWireProfile, enabled: boolean): ReasoningWireProfile {
  if (profile.disabled) return profile

  const configured: ReasoningWireProfile = { ...profile }
  for (const key of ['default', 'auto', 'effort'] as const) {
    const mode = stripReasoningSummary(configured[key])
    if (enabled) {
      configured[key] = {
        ...mode,
        operations: [...(mode?.operations ?? []), ...REASONING_SUMMARY_OPERATIONS]
      } as ReasoningWireMode
    } else if (mode) {
      configured[key] = mode
    } else {
      delete configured[key]
    }
  }
  return configured
}

/**
 * OpenAI's own Responses reasoning wire. Third-party hosts opt in through an
 * endpoint dialect override because some reject `reasoning.summary`.
 */
export const openaiResponsesSummaryWire = configureOpenAIResponsesSummary(genericEffort(), true)

const formatProfiles = {
  'openai-chat': {
    wire: genericEffort()
  },
  // No `reasoning.summary` here: third-party Responses hosts emit summaries unasked and reject the
  // field (Ark 400s on it). OpenAI's own hosts opt in via `openaiResponsesSummaryWire`.
  'openai-responses': {
    wire: genericEffort()
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
