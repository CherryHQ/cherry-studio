import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'

import type { DispatchDecision } from '../toolApproval/ToolApprovalRegistry'

/**
 * Map a neutral `DispatchDecision` to the Claude Agent SDK `PermissionResult`
 * the `canUseTool` promise must resolve with. `originalInput` is the fallback
 * when an approval carries no edited input.
 */
export function decisionToPermissionResult(
  decision: DispatchDecision,
  originalInput: Record<string, unknown>
): PermissionResult {
  return decision.approved
    ? { behavior: 'allow', updatedInput: decision.updatedInput ?? originalInput }
    : { behavior: 'deny', message: decision.reason ?? 'User denied permission for this tool' }
}
