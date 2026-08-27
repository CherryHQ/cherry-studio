/** Compatibility surface while runtime adapters migrate to @cherrystudio/agent-permission. */
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
} from '@cherrystudio/agent-permission'
export { evaluateToolGuards, validateToolGuardRules } from '@cherrystudio/agent-permission'
