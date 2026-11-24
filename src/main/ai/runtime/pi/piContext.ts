import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { ensureAgentSessionRootTx } from '@data/services/agentSessionMessageTree'
import { agentSessionService } from '@data/services/AgentSessionService'
import { retargetRuntimeBranchTx } from '@main/ai/agentSession/runtimeBranchTakeover'

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
    let foreignBranch = false
    if (existing) {
      if (contexts.backendTx(tx, existing.backendId).locator.kind === 'pi') {
        if (nativeId && existing.nativeThreadId !== nativeId)
          throw new Error('Requested Pi identity does not match the captured branch')
        return existing
      }
      foreignBranch = true
      // The resolved binding was captured under a previous runtime backend (e.g. the
      // agent's runtime was switched on this conversation); the pi branch takes over
      // from this anchor instead of rejecting the turn. (sessionId, anchorMessageId)
      // is unique, so an identical anchor must reuse the row.
      if (existing.anchorMessageId === anchor) {
        if (existing.bindingState === 'bound') throw new Error('The selected branch belongs to another runtime')
        const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'pi' }, 'bound')
        return retargetRuntimeBranchTx(tx, existing, backend.id, uuid())
      }
    }
    return reservePiBranchTx(tx, sessionId, anchor, foreignBranch ? uuid() : (nativeId ?? uuid()))
  })
}
