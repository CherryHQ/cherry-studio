import type { AgentPermissionMode, PermissionContext } from '@cherrystudio/agent-permission'
import type { ToolGuardInteractionState, ToolGuardRule } from '@cherrystudio/agent-permission'

interface BuildClaudePermissionContextInput {
  mode: AgentPermissionMode
  roots: PermissionContext['roots']
  isDisabled: PermissionContext['isDisabled']
  interaction: ToolGuardInteractionState
  delegated: boolean
  builtinRole?: string
  guardRules?: readonly ToolGuardRule[]
  guardContext?: unknown
  log?: PermissionContext['log']
}

/** The SDK uses `agent_id` for subagent hook input and `agentID` for canUseTool options. */
export function isClaudeDelegatedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Keep canUseTool and PreToolUse on the same interaction facts for warm and delegated calls. */
export function buildClaudePermissionContext(input: BuildClaudePermissionContextInput): PermissionContext {
  const interaction = input.delegated
    ? { currentTurn: 'headless' as const, userResponse: 'unavailable' as const }
    : input.interaction

  return {
    mode: input.mode,
    roots: input.roots,
    isDisabled: input.isDisabled,
    responder: interaction.userResponse,
    turn: interaction.currentTurn === 'headless' ? 'headless' : 'interactive',
    delegated: input.delegated,
    interaction,
    builtinRole: input.builtinRole,
    guardRules: input.guardRules,
    guardContext: input.guardContext,
    log: input.log
  }
}
