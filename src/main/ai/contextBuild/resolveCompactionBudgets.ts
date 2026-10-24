/**
 * Shared compaction trigger budgets for the durable and in-loop lanes.
 *
 * Both lanes derive the same four numbers from the declared window, so they
 * live here rather than as duplicated arithmetic at each call site.
 */
import { COMPACTION_CONTEXT_WINDOW_SAFETY_MARGIN, CONTEXT_COMPACT_KEEP_BUDGET_OF_TRIGGER } from '../constants'
import { resolveInputRoom } from './resolveInputRoom'

export function resolveCompactionBudgets(
  contextWindow: number,
  reservation: number | undefined,
  thresholdPercent: number
): {
  effectiveContextWindow: number
  inputRoom: number
  trigger: number
  keepBudget: number
} {
  const effectiveContextWindow = Math.floor(contextWindow * COMPACTION_CONTEXT_WINDOW_SAFETY_MARGIN)
  const inputRoom = resolveInputRoom(effectiveContextWindow, reservation)
  const trigger = Math.floor((inputRoom * thresholdPercent) / 100)
  const keepBudget = Math.floor(trigger * CONTEXT_COMPACT_KEEP_BUDGET_OF_TRIGGER)
  return { effectiveContextWindow, inputRoom, trigger, keepBudget }
}
