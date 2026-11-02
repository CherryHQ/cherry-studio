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

const locatorSchema = z.discriminatedUnion('kind', [
  z.object({ version: z.literal(1), kind: z.literal('pi') }),
  z.object({
    version: z.literal(1),
    kind: z.literal('pi-durable'),
    fileName: z.string().regex(/^[a-zA-Z0-9_-]+\.sqlite$/)
  })
])

class AgentSessionContextService {
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

  allocateContext(sessionId: string, backendId: string, intendedThreadId?: string): AgentSessionContextRow {
    return application
      .get('DbService')
      .withWriteTx((tx) => this.allocateContextTx(tx, sessionId, backendId, intendedThreadId))
  }

  allocateContextTx(
    tx: DbOrTx,
    sessionId: string,
    backendId: string,
    intendedThreadId?: string
  ): AgentSessionContextRow {
    this.backendTx(tx, backendId)
    if (intendedThreadId) {
      const existing = tx
        .select()
        .from(contexts)
        .where(
          and(
            eq(contexts.sessionId, sessionId),
            eq(contexts.backendId, backendId),
            eq(contexts.intendedThreadId, intendedThreadId)
          )
        )
        .get()
      if (existing) return existing
    }
    return tx.insert(contexts).values({ sessionId, backendId, intendedThreadId }).returning().get()
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
      if (
        (row.nativeThreadId && row.nativeThreadId !== nativeThreadId) ||
        (row.intendedThreadId && row.intendedThreadId !== nativeThreadId)
      ) {
        throw new Error('Native context identity cannot change')
      }
      return tx
        .update(contexts)
        .set({ nativeThreadId, updatedAt: Date.now() })
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
