import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { ensureAgentSessionRootTx } from '@data/services/agentSessionMessageTree'
import { agentSessionService } from '@data/services/AgentSessionService'

import { BranchRuntimeMismatchError } from '../branchRuntimeMismatch'

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
    const existing = contexts.branchTx(tx, sessionId, messageId ?? root)
    if (existing) {
      if (contexts.backendTx(tx, existing.backendId).locator.kind !== 'pi-durable')
        throw new BranchRuntimeMismatchError('The selected branch belongs to another runtime')
      return existing
    }
    const backend = allocateDurableBackendTx(tx)
    return contexts.reserveBranchTx(tx, { sessionId, backendId: backend.id, anchorMessageId: root })
  })
}
