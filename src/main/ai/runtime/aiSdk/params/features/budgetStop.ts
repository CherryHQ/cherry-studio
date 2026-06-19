import { isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { application } from '@main/core/application'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import { MAX_TOOL_CALLS, MIN_TOOL_CALLS } from '@shared/config/constant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { StopCondition, ToolSet } from 'ai'

import type { RequestFeature } from '../feature'

/** Stop the turn when the live prompt crosses this fraction of the context window. */
const BUDGET_FRACTION = 0.8

/**
 * Mirrors SDK_DEFAULT_STEP_COUNT from buildAgentParams — the fallback cap when no
 * assistant is present or when the assistant has not customised maxToolCalls.
 */
const DEFAULT_STEP_CAP = 20

/** Resolve the effective step cap for a scope (mirrors resolveStopWhenForAssistant). */
function resolveStepCap(scope: Parameters<NonNullable<RequestFeature['contributeStopConditions']>>[0]): number {
  const assistant = scope.assistant
  if (!assistant) return DEFAULT_STEP_CAP
  const enableMaxToolCalls = assistant.settings?.enableMaxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls
  if (!enableMaxToolCalls) return DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
  const raw = assistant.settings?.maxToolCalls
  const valid = raw !== undefined && raw >= MIN_TOOL_CALLS && raw <= MAX_TOOL_CALLS
  return valid ? raw : DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
}

/**
 * Stops the agentic loop at the next step boundary when the most recent step's
 * `totalTokens` (input + output) crosses BUDGET_FRACTION × contextWindow, and records
 * the trip on AiStreamManager (keyed by topic+model) so onExecutionDone can re-dispatch
 * a budget-continue. The flag is set ONLY when:
 *   1. The budget threshold is crossed, AND
 *   2. The step cap is NOT the binding constraint (steps.length < cap).
 *
 * totalTokens mirrors the metric used by the turn-start compaction trigger
 * (contextTokens anchor = prior step's totalTokens), so both thresholds are measured on
 * the same scale. When the provider omits usage entirely (totalTokens is undefined) the
 * predicate returns false — no tokenizer fallback is attempted here because the
 * StepResult API does not expose the full prompt/history, only the generated content
 * (which would undercount the input side).
 *
 * Persistent-chat-only: the feature is excluded for agent-session topics (they manage
 * their own runtime queue) and temporary-chat topics (budget-continue throws for them).
 */
export const budgetStopFeature: RequestFeature = {
  name: 'budget-stop',
  applies: (scope) => {
    const topicId = scope.request.chatId
    if (!topicId) return false
    if ((scope.model.contextWindow ?? 0) <= 0) return false
    if (isAgentSessionTopic(topicId)) return false
    if (temporaryChatService.hasTopic(topicId)) return false
    return true
  },
  contributeStopConditions: (scope): StopCondition<ToolSet>[] => {
    const topicId = scope.request.chatId
    const contextWindow = scope.model.contextWindow
    const modelId = scope.model.id
    if (!topicId || !contextWindow) return []
    const threshold = BUDGET_FRACTION * contextWindow
    const stepCap = resolveStepCap(scope)
    return [
      ({ steps }) => {
        const totalTokens = steps.at(-1)?.usage.totalTokens
        if (totalTokens !== undefined && totalTokens >= threshold && steps.length < stepCap) {
          application.get('AiStreamManager').setBudgetTripped(topicId, modelId)
          return true
        }
        return false
      }
    ]
  }
}
