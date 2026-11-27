import { v4 as uuid } from 'uuid'

import { application } from '@application'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import type { DbOrTx } from '@data/db/types'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { ensureAgentSessionRootTx, getAgentSessionHead } from '@data/services/agentSessionMessageTree'
import { agentSessionService } from '@data/services/AgentSessionService'
import { retargetRuntimeBranchTx } from '@main/ai/agentSession/runtimeBranchTakeover'

export function resolveClaudeBranchResumeToken(
  sessionId: string,
  configDir: string,
  candidate?: string,
  messageId?: string
): string | undefined {
  const db = application.get('DbService').getDb()
  const anchor = messageId ?? getAgentSessionHead(db, sessionId)
  if (anchor) {
    const existing = contexts.branchTx(db, sessionId, anchor)
    if (existing) {
      const owner = contexts.backendTx(db, existing.backendId)
      if (owner.locator.kind !== 'claude-code' || owner.locator.configDir !== configDir) return undefined
      return existing.bindingState === 'bound' ? (existing.nativeThreadId ?? undefined) : undefined
    }
  }
  if (!candidate) return undefined
  return contexts.hasNativeThreadForLocatorTx(db, sessionId, { version: 1, kind: 'claude-code', configDir }, candidate)
    ? candidate
    : undefined
}

export function prepareClaudeBranch(
  sessionId: string,
  configDir: string,
  nativeId?: string,
  messageId?: string,
  opening = false
) {
  agentSessionService.assertIndependentSession(sessionId)
  return application.get('DbService').withWriteTx((tx) => {
    const root = ensureAgentSessionRootTx(tx, sessionId)
    const anchor = messageId ?? getAgentSessionHead(tx, sessionId) ?? root
    const existing = contexts.branchTx(tx, sessionId, anchor)
    let foreignBranch = false
    if (existing) {
      const owner = contexts.backendTx(tx, existing.backendId)
      const sameRuntime = owner.locator.kind === 'claude-code' && owner.locator.configDir === configDir
      if (sameRuntime && (opening || !nativeId || existing.nativeThreadId === nativeId)) return existing
      foreignBranch = true
      // The resolved binding was captured under a previous runtime backend; the
      // claude branch takes over from this anchor instead of rejecting the turn.
      if (existing.anchorMessageId === anchor) {
        if (existing.bindingState === 'bound') throw new Error('The selected branch belongs to another runtime backend')
        const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'claude-code', configDir }, 'bound')
        return retargetRuntimeBranchTx(tx, existing, backend.id, uuid())
      }
    }
    const backend = contexts.ensureBackendTx(tx, { version: 1, kind: 'claude-code', configDir }, 'bound')
    return contexts.reserveBranchTx(tx, {
      sessionId,
      backendId: backend.id,
      nativeThreadId: foreignBranch ? uuid() : (nativeId ?? uuid()),
      anchorMessageId: anchor,
      checkpointMapping: opening && !nativeId ? { referenceHistory: true } : undefined
    })
  })
}

export function claudeBranchQueryIdentity(context: AgentSessionContextRow, requestedResume?: string) {
  const nativeId = context.nativeThreadId!
  const resume = context.bindingState === 'bound' || requestedResume === nativeId ? nativeId : undefined
  return { resume, sessionId: resume ? undefined : context.nativeThreadId! }
}

export function reserveClaudeBranchTx(
  tx: DbOrTx,
  sessionId: string,
  anchor: string,
  nativeId: string,
  sourceBackendId?: string
) {
  const backendId = contexts.branchTx(tx, sessionId, anchor)?.backendId ?? sourceBackendId
  if (!backendId || contexts.backendTx(tx, backendId).locator.kind !== 'claude-code')
    throw new Error('Claude edit requires an existing native backend')
  return contexts.reserveBranchTx(tx, {
    sessionId,
    backendId,
    anchorMessageId: anchor,
    nativeThreadId: nativeId
  })
}
