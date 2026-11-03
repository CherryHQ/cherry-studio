import { and, eq } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import {
  agentRuntimeBackendTable as backends,
  type AgentRuntimeBackendRow,
  type AgentRuntimeLocator
} from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import { agentSessionContextTable as contexts, type AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import type { DbOrTx } from '@data/db/types'

import { ensureAgentSessionRootTx, readAgentSessionAncestry } from './agentSessionMessageTree'
import { agentSessionService } from './AgentSessionService'

const locatorSchema = z.discriminatedUnion('kind', [
  z.object({ version: z.literal(1), kind: z.literal('pi') }),
  z.object({
    version: z.literal(1),
    kind: z.literal('pi-durable'),
    fileName: z.string().regex(/^[a-zA-Z0-9_-]+\.sqlite$/)
  })
])

class AgentSessionContextService {
  child(
    parentContextId: string,
    subagentId: string,
    nativeThreadId: string,
    toolCallId: string,
    name: string
  ): AgentSessionContextRow {
    return application.get('DbService').withWriteTx((tx) => {
      const parent = tx.select().from(contexts).where(eq(contexts.id, parentContextId)).get()
      if (!parent) throw new Error('Parent context is unavailable')
      const found = tx
        .select()
        .from(contexts)
        .where(and(eq(contexts.parentContextId, parentContextId), eq(contexts.subagentId, subagentId)))
        .get()
      if (found) {
        if (found.nativeThreadId !== nativeThreadId) throw new Error('Child identity changed')
        return found
      }
      const parentSession = tx.select().from(sessions).where(eq(sessions.id, parent.sessionId)).get()!
      const sessionId = agentSessionService.createChildArchiveTx(
        tx,
        parentSession.ownerSessionId ?? parent.sessionId,
        name
      )
      return tx
        .insert(contexts)
        .values({
          sessionId,
          parentContextId,
          subagentId,
          nativeThreadId,
          bindingState: 'bound',
          backendId: parent.backendId,
          spawnToolCallId: toolCallId,
          anchorMessageId: ensureAgentSessionRootTx(tx, sessionId),
          checkpointMapping: { child: { sources: {} } }
        })
        .returning()
        .get()
    })
  }

  findChild(ownerSessionId: string, toolCallId: string): AgentSessionContextRow | undefined {
    const rows = application
      .get('DbService')
      .getDb()
      .select({ context: contexts })
      .from(contexts)
      .innerJoin(sessions, eq(sessions.id, contexts.sessionId))
      .where(and(eq(sessions.ownerSessionId, ownerSessionId), eq(contexts.spawnToolCallId, toolCallId)))
      .all()
    return rows.length === 1 ? rows[0].context : undefined
  }

  saveProjectionTx(
    tx: DbOrTx,
    contextId: string,
    mapping: Record<string, string>,
    gap?: string,
    removed?: readonly string[],
    composition?: Record<string, { messageId: string; parts: number[] }[]>
  ): void {
    const checkpoint = tx.select().from(contexts).where(eq(contexts.id, contextId)).get()?.checkpointMapping
    tx.update(contexts)
      .set({
        checkpointMapping: {
          ...checkpoint,
          child: {
            ...checkpoint?.child,
            sources: mapping,
            gap,
            ...(removed && { removed }),
            ...(composition && { composition })
          }
        }
      })
      .where(eq(contexts.id, contextId))
      .run()
  }

  reserveBranchTx(
    tx: DbOrTx,
    binding: Pick<AgentSessionContextRow, 'sessionId' | 'backendId' | 'anchorMessageId'> &
      Partial<Pick<AgentSessionContextRow, 'nativeThreadId' | 'checkpointMapping'>>
  ): AgentSessionContextRow {
    this.backendTx(tx, binding.backendId)
    if (!binding.anchorMessageId) throw new Error('Branch anchor is required')
    readAgentSessionAncestry(tx, binding.sessionId, binding.anchorMessageId)
    const nativeId = binding.nativeThreadId
    const existing = nativeId
      ? tx
          .select()
          .from(contexts)
          .where(
            and(
              eq(contexts.sessionId, binding.sessionId),
              eq(contexts.backendId, binding.backendId),
              eq(contexts.nativeThreadId, nativeId)
            )
          )
          .get()
      : undefined
    if (existing) {
      if (existing.anchorMessageId && existing.anchorMessageId !== binding.anchorMessageId)
        throw new Error('Native context already belongs to another branch')
      return tx.update(contexts).set(binding).where(eq(contexts.id, existing.id)).returning().get()
    }
    return tx.insert(contexts).values(binding).returning().get()
  }

  branchTx(tx: DbOrTx, sessionId: string, messageId: string) {
    const path = readAgentSessionAncestry(tx, sessionId, messageId)
    const bindings = tx.select().from(contexts).where(eq(contexts.sessionId, sessionId)).all()
    return path
      .toReversed()
      .map((row) => bindings.find((binding) => binding.anchorMessageId === row.id))
      .find((binding) => binding !== undefined)
  }

  publishBranchTx(tx: DbOrTx, sessionId: string, nativeId: string, checkpointMapping: Record<string, unknown>): void {
    tx.update(contexts)
      .set({ nativeThreadId: nativeId, bindingState: 'bound', checkpointMapping: { fork: checkpointMapping } })
      .where(and(eq(contexts.sessionId, sessionId), eq(contexts.nativeThreadId, nativeId)))
      .run()
  }

  confirmBranchTx(tx: DbOrTx, contextId: string, sessionId: string, messageId: string, nativeId: string): void {
    const binding = this.contextTx(tx, contextId)
    if (binding.sessionId !== sessionId || this.branchTx(tx, sessionId, messageId)?.id !== contextId)
      throw new Error('Native output belongs to another branch')
    if (binding.nativeThreadId !== nativeId) throw new Error('Native context identity cannot change')
    tx.update(contexts).set({ nativeThreadId: nativeId, bindingState: 'bound' }).where(eq(contexts.id, contextId)).run()
  }

  ensureBackendTx(
    tx: DbOrTx,
    locator: AgentRuntimeLocator,
    state: AgentRuntimeBackendRow['state']
  ): AgentRuntimeBackendRow {
    const parsed = locatorSchema.parse(locator)
    const existing = tx.select().from(backends).where(eq(backends.locator, parsed)).get()
    return existing ?? tx.insert(backends).values({ locator: parsed, state }).returning().get()
  }

  backend(id: string): AgentRuntimeBackendRow {
    return this.backendTx(application.get('DbService').getDb(), id)
  }

  backendTx(tx: DbOrTx, id: string): AgentRuntimeBackendRow {
    const row = tx.select().from(backends).where(eq(backends.id, id)).get()
    if (!row) throw new Error('Runtime backend does not exist')
    return { ...row, locator: locatorSchema.parse(row.locator) }
  }

  bindBackend(id: string): void {
    application.get('DbService').withWriteTx((tx) => {
      if (this.backendTx(tx, id).state === 'bound') return
      tx.update(backends).set({ state: 'bound', updatedAt: Date.now() }).where(eq(backends.id, id)).run()
    })
  }

  allocateContext(sessionId: string, backendId: string, nativeThreadId?: string): AgentSessionContextRow {
    return application
      .get('DbService')
      .withWriteTx((tx) => this.allocateContextTx(tx, sessionId, backendId, nativeThreadId))
  }

  allocateContextTx(tx: DbOrTx, sessionId: string, backendId: string, nativeThreadId?: string): AgentSessionContextRow {
    this.backendTx(tx, backendId)
    if (nativeThreadId) {
      const existing = tx
        .select()
        .from(contexts)
        .where(
          and(
            eq(contexts.sessionId, sessionId),
            eq(contexts.backendId, backendId),
            eq(contexts.nativeThreadId, nativeThreadId)
          )
        )
        .get()
      if (existing) return existing
    }
    return tx.insert(contexts).values({ sessionId, backendId, nativeThreadId }).returning().get()
  }

  context(id: string): AgentSessionContextRow {
    return this.contextTx(application.get('DbService').getDb(), id)
  }

  contextTx(tx: DbOrTx, id: string): AgentSessionContextRow {
    const row = tx.select().from(contexts).where(eq(contexts.id, id)).get()
    if (!row) throw new Error('Native context does not exist')
    return row
  }

  bindContext(id: string, nativeThreadId: string): AgentSessionContextRow {
    if (!nativeThreadId.trim()) throw new Error('Native thread identity is empty')
    return application.get('DbService').withWriteTx((tx) => {
      const row = this.contextTx(tx, id)
      if (row.nativeThreadId && row.nativeThreadId !== nativeThreadId) {
        throw new Error('Native context identity cannot change')
      }
      return tx
        .update(contexts)
        .set({ nativeThreadId, bindingState: 'bound', updatedAt: Date.now() })
        .where(eq(contexts.id, id))
        .returning()
        .get()
    })
  }

  forSession(sessionId: string): AgentSessionContextRow[] {
    return application.get('DbService').getDb().select().from(contexts).where(eq(contexts.sessionId, sessionId)).all()
  }
}

export const agentSessionContextService = new AgentSessionContextService()
