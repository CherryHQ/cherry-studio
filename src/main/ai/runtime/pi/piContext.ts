import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { ensureAgentSessionRootTx } from '@data/services/agentSessionMessageTree'
import { agentSessionService } from '@data/services/AgentSessionService'

export function reservePiBranchTx(tx: DbOrTx, sessionId: string, anchorMessageId: string, nativeId: string) {
  const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'pi' }, 'bound')
  return contexts.reserveBranchTx(tx, { sessionId, backendId: backend.id, anchorMessageId, nativeThreadId: nativeId })
}

export function preparePiBranch(sessionId: string, messageId?: string, nativeId?: string) {
  agentSessionService.assertIndependentSession(sessionId)
  return application.get('DbService').withWriteTx((tx) => {
    const root = ensureAgentSessionRootTx(tx, sessionId)
    const anchor = messageId ?? root
    const existing = contexts.branchTx(tx, sessionId, anchor)
    const hasReset = contexts.hasStaleResetBoundaryTx(tx, sessionId, anchor)
    if (existing) {
      if (contexts.backendTx(tx, existing.backendId).locator.kind !== 'pi')
        throw new Error('The selected branch belongs to another runtime')
      // Same stale-reset rotation as Claude: a binding at/below the boundary
      // holds the dead identity, so refresh it instead of reusing it.
      if (hasReset && (!nativeId || existing.nativeThreadId !== nativeId)) {
        return contexts.refreshResetBranchTx(tx, existing.id, nativeId ?? uuid())
      }
      if (nativeId && existing.nativeThreadId !== nativeId)
        throw new Error('Requested Pi identity does not match the captured branch')
      return existing
    }
    // Hidden root binding still occupies `(sessionId, root)` — anchor fresh at
    // the failed head so siblings keep the root binding.
    return reservePiBranchTx(tx, sessionId, hasReset ? anchor : root, nativeId ?? uuid())
  })
}
