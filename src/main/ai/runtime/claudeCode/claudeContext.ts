import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { ensureAgentSessionRootTx, getAgentSessionHead } from '@data/services/agentSessionMessageTree'
import { agentSessionService } from '@data/services/AgentSessionService'

export function prepareClaudeBranch(sessionId: string, configDir: string, nativeId?: string, messageId?: string) {
  agentSessionService.assertIndependentSession(sessionId)
  return application.get('DbService').withWriteTx((tx) => {
    const root = ensureAgentSessionRootTx(tx, sessionId)
    const anchor = messageId ?? getAgentSessionHead(tx, sessionId) ?? root
    const existing = contexts.branchTx(tx, sessionId, anchor)
    const resetBoundaryId = contexts.lastStaleResetBoundaryTx(tx, sessionId, anchor)
    if (existing) {
      const backend = contexts.backendTx(tx, existing.backendId)
      if (backend.locator.kind !== 'claude-code' || backend.locator.configDir !== configDir)
        throw new Error('The selected branch belongs to another runtime backend')
      if (resetBoundaryId !== undefined) {
        const handled =
          (existing.checkpointMapping as { staleResetHandled?: string } | null | undefined)?.staleResetHandled ===
          resetBoundaryId
        if (handled) {
          // Already survived this reset: the binding holds a healthy recovered
          // identity, not the dead conversation. Reuse it for the same
          // identity; fork a separate context for a new native (e.g. `/clear`
          // on a descendant) instead of rewriting in place, which would break
          // observers holding `(contextId, nativeThreadId)` (#23519 review).
          if (!nativeId || existing.nativeThreadId === nativeId) return existing
          if (existing.anchorMessageId !== anchor) {
            return contexts.reserveBranchTx(tx, {
              sessionId,
              backendId: existing.backendId,
              nativeThreadId: nativeId,
              anchorMessageId: anchor,
              checkpointMapping: { staleResetHandled: resetBoundaryId }
            })
          }
          // Same-anchor with a new native after recovery: the anchor is
          // occupied so a separate row would violate
          // `agent_session_context_anchor_uniq`, and rewriting in place would
          // break observers holding `(contextId, nativeThreadId)` (their next
          // `bindNativeInput` throws `Native input target does not match the
          // captured context`). Persistent connections pass a stale
          // `branchHead` while the product head has advanced to a descendant;
          // fork there to preserve the healthy recovered context (#23519).
          const currentHead = getAgentSessionHead(tx, sessionId) ?? root
          if (currentHead !== anchor) {
            const headBoundary = contexts.lastStaleResetBoundaryTx(tx, sessionId, currentHead)
            const headBinding = contexts.branchTx(tx, sessionId, currentHead)
            const headFree = !headBinding || headBinding.anchorMessageId !== currentHead
            if (headBoundary === resetBoundaryId && headFree) {
              return contexts.reserveBranchTx(tx, {
                sessionId,
                backendId: existing.backendId,
                nativeThreadId: nativeId,
                anchorMessageId: currentHead,
                checkpointMapping: { staleResetHandled: resetBoundaryId }
              })
            }
            if (headBinding && headBinding.nativeThreadId === nativeId) return headBinding
          }
          // No free descendant anchor (head hasn't advanced, or it belongs to
          // another branch): preserve the healthy binding instead of rewriting
          // it, matching Pi's mismatch semantics. The caller must supply a
          // descendant anchor (e.g. current head after `/clear`).
          throw new Error('Recovered Claude context cannot change native identity at the same anchor')
        }
        // Unhandled (holds the dead identity): same-anchor collides, so rotate
        // in place; descendant anchors are free, so fork fresh there.
        if (existing.anchorMessageId === anchor) {
          // If the caller explicitly requested a different live identity, adopt
          // it; otherwise generate a fresh one so the next connect goes clean.
          // `nativeId` matching the dead identity is also rotated away — reusing
          // it would fail identically.
          return contexts.refreshResetBranchTx(
            tx,
            existing.id,
            nativeId && nativeId !== existing.nativeThreadId ? nativeId : uuid(),
            resetBoundaryId
          )
        }
        return contexts.reserveBranchTx(tx, {
          sessionId,
          backendId: existing.backendId,
          nativeThreadId: nativeId ?? uuid(),
          anchorMessageId: anchor,
          checkpointMapping: { staleResetHandled: resetBoundaryId }
        })
      }
      if (!nativeId || existing.nativeThreadId === nativeId) return existing
    }
    const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'claude-code', configDir }, 'bound')
    // After a stale-resume reset the pre-reset root binding is hidden from
    // `branchTx` but still occupies `(sessionId, root)`. Reserving a second row
    // at root would violate `agent_session_context_anchor_uniq`, so anchor the
    // fresh branch at the failed head. Sibling paths exclude the boundary row
    // and keep resolving to the retained root binding.
    const anchorForFresh = existing ? anchor : resetBoundaryId !== undefined ? anchor : root
    return contexts.reserveBranchTx(tx, {
      sessionId,
      backendId: backend.id,
      nativeThreadId: nativeId ?? uuid(),
      anchorMessageId: anchorForFresh,
      ...(resetBoundaryId !== undefined ? { checkpointMapping: { staleResetHandled: resetBoundaryId } } : {})
    })
  })
}

export function reserveClaudeBranchTx(tx: DbOrTx, sessionId: string, anchor: string, nativeId: string) {
  const parent = contexts.branchTx(tx, sessionId, anchor)
  if (!parent || contexts.backendTx(tx, parent.backendId).locator.kind !== 'claude-code')
    throw new Error('Claude edit requires an existing native backend')
  return contexts.reserveBranchTx(tx, {
    sessionId,
    backendId: parent.backendId,
    anchorMessageId: anchor,
    nativeThreadId: nativeId
  })
}
