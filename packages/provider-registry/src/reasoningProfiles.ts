import type { ReasoningEffort } from './schemas/enums'
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
    }
  },
  gemini: {
    wire: {
      off: mode([literal('thinkingConfig.includeThoughts', false), literal('thinkingConfig.thinkingLevel', 'minimal')]),
      auto: mode([literal('thinkingConfig.includeThoughts', true)]),
      effort: mode([literal('thinkingConfig.includeThoughts', true), effort('thinkingConfig.thinkingLevel')])
    }
  },
  ollama: {
    wire: {
      off: mode([literal('think', false)]),
      auto: mode([literal('think', true)]),
      effort: mode([effort('think')])
    }
  },
  none: {
    wire: { disabled: true }
  }
} as const satisfies Record<ReasoningFormatType, ReasoningFormatWireProfile>

export const REASONING_FORMAT_PROFILES: Record<ReasoningFormatType, ReasoningFormatWireProfile> = formatProfiles
