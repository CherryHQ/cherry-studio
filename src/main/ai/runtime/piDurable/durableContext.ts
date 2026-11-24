import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { ensureAgentSessionRootTx } from '@data/services/agentSessionMessageTree'
import { agentSessionService } from '@data/services/AgentSessionService'
import { retargetRuntimeBranchTx } from '@main/ai/agentSession/runtimeBranchTakeover'

export function allocateDurableBackendTx(tx: DbOrTx) {
  return contexts.ensureBackendTx(tx, { version: 1, kind: 'pi-durable', fileName: `${uuid()}.sqlite` }, 'creating')
}

export function reserveDurableBranchTx(
  tx: DbOrTx,
  sessionId: string,
  anchorMessageId: string,
  nativeId: string,
  contextId?: string
) {
  if (!contextId)
    return contexts.reserveBranchTx(tx, {
      id: nativeId,
      sessionId,
      backendId: allocateDurableBackendTx(tx).id,
      anchorMessageId
    })
  const parent = contexts.branchTx(tx, sessionId, anchorMessageId)
  if (!parent || contexts.backendTx(tx, parent.backendId).locator.kind !== 'pi-durable')
    throw new Error('Durable edit requires an existing native backend')
  return contexts.reserveBranchTx(tx, {
    id: contextId,
    sessionId,
    backendId: parent.backendId,
    anchorMessageId,
    nativeThreadId: nativeId
  })
}

export function prepareDurableBranch(sessionId: string, messageId?: string) {
  agentSessionService.assertIndependentSession(sessionId)
  return application.get('DbService').withWriteTx((tx) => {
    const root = ensureAgentSessionRootTx(tx, sessionId)
    const anchor = messageId ?? root
    const existing = contexts.branchTx(tx, sessionId, anchor)
    if (existing) {
      if (contexts.backendTx(tx, existing.backendId).locator.kind === 'pi-durable') return existing
      // The resolved binding was captured under a previous runtime backend; the
      // durable branch takes over from this anchor instead of rejecting the turn.
      if (existing.anchorMessageId === anchor) {
        if (existing.bindingState === 'bound') throw new Error('The selected branch belongs to another runtime')
        const backend = allocateDurableBackendTx(tx)
        return retargetRuntimeBranchTx(tx, existing, backend.id, null)
      }
    }
    const backend = allocateDurableBackendTx(tx)
    return contexts.reserveBranchTx(tx, { sessionId, backendId: backend.id, anchorMessageId: anchor })
  })
}
