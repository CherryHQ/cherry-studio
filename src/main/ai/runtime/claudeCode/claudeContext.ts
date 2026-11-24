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
    if (existing) {
      const owner = contexts.backendTx(tx, existing.backendId)
      if (
        owner.locator.kind === 'claude-code' &&
        owner.locator.configDir === configDir &&
        (!nativeId || existing.nativeThreadId === nativeId)
      )
        return existing
      // The resolved binding was captured under a previous runtime backend; the
      // claude branch takes over from this anchor instead of rejecting the turn.
      if (existing.anchorMessageId === anchor) {
        if (existing.bindingState === 'bound') throw new Error('The selected branch belongs to another runtime backend')
        const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'claude-code', configDir }, 'bound')
        return contexts.retargetBranchTx(tx, existing.id, backend.id, nativeId ?? uuid())
      }
    }
    const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'claude-code', configDir }, 'bound')
    return contexts.reserveBranchTx(tx, {
      sessionId,
      backendId: backend.id,
      nativeThreadId: nativeId ?? uuid(),
      anchorMessageId: anchor
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
