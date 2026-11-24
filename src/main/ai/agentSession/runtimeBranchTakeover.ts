import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import type { DbOrTx } from '@data/db/types'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'

/** Retargets a pending branch while keeping already-captured inputs on their original native target. */
export function retargetRuntimeBranchTx(
  tx: DbOrTx,
  branch: AgentSessionContextRow,
  backendId: string,
  nativeThreadId: string | null
): AgentSessionContextRow {
  const preserveTarget = messages.hasInputContextBindingTx(tx, branch.sessionId, branch.id)
  const retargeted = contexts.retargetBranchTx(tx, branch.id, backendId, nativeThreadId, preserveTarget)
  if (retargeted.recoveryContext) {
    messages.moveInputContextBindingsTx(tx, branch.sessionId, branch.id, retargeted.recoveryContext.id)
  }
  return retargeted.context
}
