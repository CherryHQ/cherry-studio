import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { ensureAgentSessionRootTx, getAgentSessionHead } from '@data/services/agentSessionMessageTree'
import { agentSessionService } from '@data/services/AgentSessionService'

export function prepareClaudeBranch(
  sessionId: string,
  source: string | { agentId: string },
  nativeId?: string,
  messageId?: string
) {
  agentSessionService.assertIndependentSession(sessionId)
  return application.get('DbService').withWriteTx((tx) => {
    const root = ensureAgentSessionRootTx(tx, sessionId)
    const anchor = messageId ?? getAgentSessionHead(tx, sessionId) ?? root
    const existing = contexts.branchTx(tx, sessionId, anchor)
    const backend = contexts.ensureBackendTx(
      tx,
      typeof source === 'string'
        ? { version: 1, kind: 'claude-code', configDir: source }
        : { version: 1, kind: 'local', agentId: source.agentId },
      'bound'
    )
    if (existing && (!nativeId || existing.nativeThreadId === nativeId)) {
      if (existing.backendId !== backend.id) throw new Error('The selected branch belongs to another runtime backend')
      return existing
    }
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
