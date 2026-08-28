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
