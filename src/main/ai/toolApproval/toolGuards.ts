/** Main compatibility wrapper. The package stays logger-free; Main supplies its existing error sink. */
import type {
  GuardCondition,
  GuardHit,
  GuardReason,
  HeadlessOverride,
  HeadlessPredicate,
  ToolGuardContext,
  ToolGuardDecision,
  ToolGuardInteractionState,
  ToolGuardRule
} from '@cherrystudio/agent-permission'
import { evaluateToolGuards as evaluatePackageToolGuards, validateToolGuardRules } from '@cherrystudio/agent-permission'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ClaudeCodeToolGuards')

export function evaluateToolGuards(
  rules: readonly ToolGuardRule[],
  ctx: ToolGuardContext
): Promise<ToolGuardDecision | undefined> {
  return evaluatePackageToolGuards(rules, {
    ...ctx,
    log:
      ctx.log ??
      ((event) =>
        logger.error(event.message, {
          ruleId: event.ruleId,
          toolName: event.toolName,
          error: event.error
        }))
  })
}

export { validateToolGuardRules }
export type {
  GuardCondition,
  GuardHit,
  GuardReason,
  HeadlessOverride,
  HeadlessPredicate,
  ToolGuardContext,
  ToolGuardDecision,
  ToolGuardInteractionState,
  ToolGuardRule
}
