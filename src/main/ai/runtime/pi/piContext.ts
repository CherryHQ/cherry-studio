import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { ensureAgentSessionRootTx } from '@data/services/agentSessionMessageTree'
import { agentSessionService } from '@data/services/AgentSessionService'

export function reservePiBranchTx(
  tx: DbOrTx,
  sessionId: string,
  anchorMessageId: string,
  nativeId: string,
  checkpointMapping?: { staleResetHandled?: string }
) {
  const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'pi' }, 'bound')
  return contexts.reserveBranchTx(tx, {
    sessionId,
    backendId: backend.id,
    anchorMessageId,
    nativeThreadId: nativeId,
    ...(checkpointMapping !== undefined ? { checkpointMapping } : {})
  })
}

export function preparePiBranch(sessionId: string, messageId?: string, nativeId?: string) {
  agentSessionService.assertIndependentSession(sessionId)
  return application.get('DbService').withWriteTx((tx) => {
    const root = ensureAgentSessionRootTx(tx, sessionId)
    const anchor = messageId ?? root
    const existing = contexts.branchTx(tx, sessionId, anchor)
    const resetBoundaryId = contexts.lastStaleResetBoundaryTx(tx, sessionId, anchor)
    if (existing) {
      if (contexts.backendTx(tx, existing.backendId).locator.kind !== 'pi')
        throw new Error('The selected branch belongs to another runtime')
      if (resetBoundaryId !== undefined) {
        const handled =
          (existing.checkpointMapping as { staleResetHandled?: string } | null | undefined)?.staleResetHandled ===
          resetBoundaryId
        if (handled) {
          // Already recovered: preserve the healthy binding. A new native on a
          // descendant (e.g. post-recovery rotation) must not rewrite it in
          // place (#23519 review). Pi surfaces mismatches instead of forking.
          if (nativeId && existing.nativeThreadId !== nativeId)
            throw new Error('Requested Pi identity does not match the captured branch')
          return existing
        }
        // Unhandled (holds the dead identity): refresh instead of reusing it.
        // Records the boundary so later native changes don't rewrite the
        // healthy recovered binding.
        return contexts.refreshResetBranchTx(tx, existing.id, nativeId ?? uuid(), resetBoundaryId)
      }
      if (nativeId && existing.nativeThreadId !== nativeId)
        throw new Error('Requested Pi identity does not match the captured branch')
      return existing
    }
    // Hidden root binding still occupies `(sessionId, root)` — anchor fresh at
    // the failed head so siblings keep the root binding.
    const freshAnchor = resetBoundaryId !== undefined ? anchor : root
    return reservePiBranchTx(
      tx,
      sessionId,
      freshAnchor,
      nativeId ?? uuid(),
      resetBoundaryId !== undefined ? { staleResetHandled: resetBoundaryId } : undefined
    )
  })
}
