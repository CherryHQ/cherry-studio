import { application } from '@application'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'

export function localContext(sessionId: string, agentId: string, anchorMessageId: string, nativeId?: string) {
  const { id, backendId, nativeThreadId } = application.get('DbService').withWriteTx((tx) => {
    const existing = contexts.branchTx(tx, sessionId, anchorMessageId)
    const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'local', agentId }, 'bound')
    if (
      existing?.backendId === backend.id &&
      (!nativeId || !existing.nativeThreadId || existing.nativeThreadId === nativeId)
    )
      return existing
    return contexts.reserveBranchTx(tx, { sessionId, backendId: backend.id, anchorMessageId })
  })
  return { id, backendId, nativeThreadId }
}

export function bindLocalContext(contextId: string, nativeId: string) {
  const { id, backendId, nativeThreadId } = contexts.bindContext(contextId, nativeId)
  return { id, backendId, nativeThreadId }
}
