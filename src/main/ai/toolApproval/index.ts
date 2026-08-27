/** Main-process compatibility barrel for the runtime-neutral permission package. */
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
