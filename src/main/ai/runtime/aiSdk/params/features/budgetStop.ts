import { application } from '@main/core/application'
import type { StopCondition, ToolSet } from 'ai'

import type { RequestFeature } from '../feature'

/** Stop the turn when the live prompt crosses this fraction of the context window. */
const BUDGET_FRACTION = 0.8

/**
 * Stops the agentic loop at the next step boundary when the most recent step's prompt
 * (`inputTokens`) crosses BUDGET_FRACTION × contextWindow, and records the trip on
 * AiStreamManager (keyed by topic+model) so onExecutionDone can re-dispatch a
 * budget-continue. The flag is set ONLY when this predicate is the reason we stop.
 */
export const budgetStopFeature: RequestFeature = {
  name: 'budget-stop',
  applies: (scope) => Boolean(scope.request.chatId) && (scope.model.contextWindow ?? 0) > 0,
  contributeStopConditions: (scope): StopCondition<ToolSet>[] => {
    const topicId = scope.request.chatId
    const contextWindow = scope.model.contextWindow
    const modelId = scope.model.id
    if (!topicId || !contextWindow) return []
    const threshold = BUDGET_FRACTION * contextWindow
    return [
      ({ steps }) => {
        const inputTokens = steps.at(-1)?.usage.inputTokens ?? 0
        if (inputTokens >= threshold) {
          application.get('AiStreamManager').setBudgetTripped(topicId, modelId)
          return true
        }
        return false
      }
    ]
  }
}
