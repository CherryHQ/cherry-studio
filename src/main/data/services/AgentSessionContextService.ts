import { and, eq } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import {
  agentRuntimeBackendTable as backends,
  type AgentRuntimeBackendRow,
  type AgentRuntimeLocator
} from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionContextTable as contexts, type AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import type { DbOrTx } from '@data/db/types'

import { ensureAgentSessionRootTx, readAgentSessionAncestry } from './agentSessionMessageTree'

const locatorSchema = z.discriminatedUnion('kind', [
  z.object({ version: z.literal(1), kind: z.literal('pi') }),
  z.object({
    version: z.literal(1),
    kind: z.literal('pi-durable'),
    fileName: z.string().regex(/^[a-zA-Z0-9_-]+\.sqlite$/)
  })
])

class AgentSessionContextService {
  bindBranchTx(
    tx: DbOrTx,
    sessionId: string,
    anchorMessageId: string,
    nativeId: string,
    checkpointMapping: Record<string, unknown> = {},
    verified = false
  ): void {
    const locator = { version: 1, kind: 'pi' } as const
    const backend =
      tx.select().from(backends).where(eq(backends.locator, locator)).get() ??
      tx.insert(backends).values({ locator, state: 'bound' }).returning().get()
    const existing = tx
      .select()
      .from(contexts)
      .where(
        and(
          eq(contexts.sessionId, sessionId),
          eq(contexts.backendId, backend.id),
          eq(contexts.nativeThreadId, nativeId)
        )
      )
      .get()
    const binding = {
      nativeThreadId: nativeId,
      anchorMessageId,
      checkpointMapping: { fork: checkpointMapping },
      bindingState: verified ? ('bound' as const) : (existing?.bindingState ?? ('pending' as const))
    }
    if (existing) {
      if (existing.anchorMessageId && existing.anchorMessageId !== anchorMessageId)
        throw new Error('Native context already belongs to another branch')
      tx.update(contexts).set(binding).where(eq(contexts.id, existing.id)).run()
    } else {
      tx.insert(contexts)
        .values({ sessionId, backendId: backend.id, ...binding })
        .run()
    }
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

  confirmBranchTx(tx: DbOrTx, sessionId: string, messageId: string, nativeId: string): void {
    const binding = this.branchTx(tx, sessionId, messageId)
    if (binding) {
      if (binding.nativeThreadId !== nativeId) throw new Error('Native output belongs to another branch')
      tx.update(contexts)
        .set({ nativeThreadId: nativeId, bindingState: 'bound' })
        .where(eq(contexts.id, binding.id))
        .run()
    } else {
      const root = ensureAgentSessionRootTx(tx, sessionId)
      this.bindBranchTx(tx, sessionId, root, nativeId, {}, true)
      this.confirmBranchTx(tx, sessionId, messageId, nativeId)
    }
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
