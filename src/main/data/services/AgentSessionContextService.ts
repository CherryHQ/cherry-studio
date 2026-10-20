import { and, eq, or } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import * as z from 'zod'

import { application } from '@application'
import { agentRuntimeBackendTable as backends, type AgentRuntimeBackendRow } from '@data/db/schemas/agentRuntimeBackend'
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
          or(eq(contexts.intendedThreadId, nativeId), eq(contexts.nativeThreadId, nativeId))
        )
      )
      .get()
    const binding = {
      intendedThreadId: nativeId,
      anchorMessageId,
      checkpointMapping,
      ...(verified ? { nativeThreadId: nativeId } : {})
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
      .set({ nativeThreadId: nativeId, checkpointMapping })
      .where(and(eq(contexts.sessionId, sessionId), eq(contexts.intendedThreadId, nativeId)))
      .run()
  }

  recordHeadTx(tx: DbOrTx, sessionId: string, messageId: string, nativeId: string): void {
    const binding = this.branchTx(tx, sessionId, messageId)
    if (binding) {
      if (binding.intendedThreadId !== nativeId) throw new Error('Native output belongs to another branch')
      tx.update(contexts)
        .set({ nativeThreadId: nativeId, headMessageId: messageId })
        .where(eq(contexts.id, binding.id))
        .run()
    } else {
      const root = ensureAgentSessionRootTx(tx, sessionId)
      this.bindBranchTx(tx, sessionId, root, nativeId, {}, true)
      this.recordHeadTx(tx, sessionId, messageId, nativeId)
    }
  }

  allocateBackend(kind: 'pi' | 'pi-durable'): AgentRuntimeBackendRow {
    return application.get('DbService').withWriteTx((tx) => {
      const locator =
        kind === 'pi'
          ? { version: 1 as const, kind }
          : {
              version: 1 as const,
              kind,
              fileName: `${uuid()}.sqlite`
            }
      if (kind === 'pi') {
        const existing = tx.select().from(backends).where(eq(backends.locator, locator)).get()
        if (existing) return existing
      }
      return tx
        .insert(backends)
        .values({ locator, state: kind === 'pi' ? 'bound' : 'creating' })
        .returning()
        .get()
    })
  }

  backend(id: string): AgentRuntimeBackendRow {
    const row = application.get('DbService').getDb().select().from(backends).where(eq(backends.id, id)).get()
    if (!row) throw new Error('Runtime backend does not exist')
    return { ...row, locator: locatorSchema.parse(row.locator) }
  }

  bindBackend(id: string): void {
    application.get('DbService').withWriteTx((tx) => {
      if (this.backend(id).state === 'bound') return
      tx.update(backends).set({ state: 'bound', updatedAt: Date.now() }).where(eq(backends.id, id)).run()
    })
  }

  allocateContext(sessionId: string, backendId: string, intendedThreadId?: string): AgentSessionContextRow {
    return application.get('DbService').withWriteTx((tx) => {
      this.backend(backendId)
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
    })
  }

  context(id: string): AgentSessionContextRow {
    const row = application.get('DbService').getDb().select().from(contexts).where(eq(contexts.id, id)).get()
    if (!row) throw new Error('Native context does not exist')
    return row
  }

  bindContext(id: string, nativeThreadId: string): AgentSessionContextRow {
    if (!nativeThreadId.trim()) throw new Error('Native thread identity is empty')
    return application.get('DbService').withWriteTx((tx) => {
      const row = this.context(id)
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
