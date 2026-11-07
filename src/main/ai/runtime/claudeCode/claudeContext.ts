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
    const hasReset = contexts.hasStaleResetBoundaryTx(tx, sessionId, anchor)
    if (existing) {
      const backend = contexts.backendTx(tx, existing.backendId)
      if (backend.locator.kind !== 'claude-code' || backend.locator.configDir !== configDir)
        throw new Error('The selected branch belongs to another runtime backend')
      // A reset boundary at/below this binding means its native identity is the
      // dead conversation: rotate to fresh instead of reusing it. The binding
      // sits at/below the boundary (branchTx only searches the effective path),
      // so siblings whose paths exclude the boundary keep their identities.
      if (hasReset && (!nativeId || existing.nativeThreadId !== nativeId)) {
        // If the caller explicitly requested a different live identity, adopt
        // it; otherwise generate a fresh one so the next connect goes clean.
        // `nativeId` matching the dead identity is also rotated away — reusing
        // it would fail identically.
        return contexts.refreshResetBranchTx(
          tx,
          existing.id,
          nativeId && nativeId !== existing.nativeThreadId ? nativeId : uuid()
        )
      }
      if (!nativeId || existing.nativeThreadId === nativeId) return existing
    }
    const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'claude-code', configDir }, 'bound')
    // After a stale-resume reset the pre-reset root binding is hidden from
    // `branchTx` but still occupies `(sessionId, root)`. Reserving a second row
    // at root would violate `agent_session_context_anchor_uniq`, so anchor the
    // fresh branch at the failed head. Sibling paths exclude the boundary row
    // and keep resolving to the retained root binding.
    const anchorForFresh = existing ? anchor : hasReset ? anchor : root
    return contexts.reserveBranchTx(tx, {
      sessionId,
      backendId: backend.id,
      nativeThreadId: nativeId ?? uuid(),
      anchorMessageId: anchorForFresh
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
