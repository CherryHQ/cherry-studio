import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'

import type { DispatchDecision } from '../toolApproval/ToolApprovalRegistry'
import { toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'

// The registry itself is driver-neutral (resolves `DispatchDecision`). Claude
// re-exports it and keeps its SDK-native conversion local, so `PermissionResult`
// never enters the shared runtime path (plan D4).
export { toolApprovalRegistry }
export type { DispatchDecision }

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
