import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'

import { modelVisibleDenial } from '@main/ai/toolApproval/modelVisibleDenial'
import type { DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'

/**
 * Map a neutral `DispatchDecision` to the Claude Agent SDK `PermissionResult`
 * the `canUseTool` promise must resolve with. `originalInput` is the fallback
 * when an approval carries no edited input.
 */
export function decisionToPermissionResult(
  decision: DispatchDecision,
  originalInput: Record<string, unknown>,
  toolName?: string
): PermissionResult {
  return decision.approved
    ? { behavior: 'allow', updatedInput: decision.updatedInput ?? originalInput }
    : { behavior: 'deny', message: modelVisibleDenial(decision, toolName) }
}
