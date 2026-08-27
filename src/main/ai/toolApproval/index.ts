/** Main-process compatibility barrel for the runtime-neutral permission package. */
export { listBuiltinToolPolicies } from './builtinToolPolicy'
export type { DispatchDecision } from './ToolApprovalRegistry'
export { toolApprovalRegistry } from './ToolApprovalRegistry'
export type {
  AgentPermissionMode,
  GuardCondition,
  GuardHit,
  GuardReason,
  HeadlessOverride,
  HeadlessPredicate,
  PermissionCall,
  PermissionContext,
  PermissionDecision,
  PermissionLogEvent,
  ToolCategory,
  ToolGuardContext,
  ToolGuardDecision,
  ToolGuardInteractionState,
  ToolGuardRule
} from '@cherrystudio/agent-permission'
export {
  AGENT_PERMISSION_MODES,
  detectDestructiveCommand,
  detectGlobalInstall,
  evaluateToolGuards,
  foldDecisions,
  HEADLESS_ASK_DENIAL,
  normalizeLegacyPermissionMode,
  validateToolGuardRules
} from '@cherrystudio/agent-permission'
