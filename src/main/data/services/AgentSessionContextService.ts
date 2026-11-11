import { and, eq, isNull } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import {
  agentRuntimeBackendTable as backends,
  type AgentRuntimeBackendRow,
  type AgentRuntimeLocator
} from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import {
  agentSessionContextTable as contexts,
  type AgentSessionContextRow,
  type AgentSessionCheckpoints
} from '@data/db/schemas/agentSessionContext'
import type { DbOrTx } from '@data/db/types'
import { Emitter } from '@main/core/lifecycle'

import { ensureAgentSessionRootTx, getAgentSessionHead, readAgentSessionAncestry } from './agentSessionMessageTree'
import { agentSessionService } from './AgentSessionService'

const locatorSchema = z.discriminatedUnion('kind', [
  z.object({ version: z.literal(1), kind: z.literal('pi') }),
  z.object({
    version: z.literal(1),
    kind: z.literal('pi-durable'),
    fileName: z.string().regex(/^[a-zA-Z0-9_-]+\.sqlite$/)
  }),
  z.object({ version: z.literal(1), kind: z.literal('claude-code'), configDir: z.string().refine(path.isAbsolute) })
])

export interface RootProjectionCheckpoint {
  contextId: string
  root: NonNullable<AgentSessionCheckpoints['root']>
}

class AgentSessionContextService {
  private readonly childCreated = new Emitter<{ ownerSessionId: string }>()
  readonly onChildCreated = this.childCreated.event

  saveRootProjectionTx(tx: DbOrTx, sessionId: string, checkpoint: RootProjectionCheckpoint): void {
    const context = tx.select().from(contexts).where(eq(contexts.id, checkpoint.contextId)).get()
    if (context?.sessionId !== sessionId) throw new Error('Projection belongs to another session')
    const removed = new Set([...(context.checkpointMapping?.root?.removed ?? []), ...checkpoint.root.removed])
    const root = {
      ...checkpoint.root,
      sources: Object.fromEntries(Object.entries(checkpoint.root.sources).filter(([id]) => !removed.has(id))),
      removed: [...removed]
    }
    tx.update(contexts)
      .set({ checkpointMapping: { ...context.checkpointMapping, root } })
      .where(eq(contexts.id, context.id))
      .run()
  }

  removeRootMessagesTx(tx: DbOrTx, sessionId: string, messageIds: readonly string[]): void {
    const removedMessages = new Set(messageIds)
    for (const context of tx.select().from(contexts).where(eq(contexts.sessionId, sessionId)).all()) {
      const root = context.checkpointMapping?.root
      if (!root) continue
      const deleted = Object.keys(root.sources).filter((id) => removedMessages.has(root.sources[id].messageId))
      if (!deleted.length) continue
      this.saveRootProjectionTx(tx, sessionId, {
        contextId: context.id,
        root: { ...root, removed: [...root.removed, ...deleted] }
      })
    }
  }
  roots(backendId: string): AgentSessionContextRow[] {
    return application
      .get('DbService')
      .getDb()
      .select({ context: contexts })
      .from(contexts)
      .innerJoin(sessions, eq(sessions.id, contexts.sessionId))
      .where(and(eq(contexts.backendId, backendId), isNull(contexts.parentContextId), isNull(sessions.deletedAt)))
      .all()
      .map((row) => row.context)
  }

  children(parentContextId: string): AgentSessionContextRow[] {
    return application
      .get('DbService')
      .getDb()
      .select()
      .from(contexts)
      .where(eq(contexts.parentContextId, parentContextId))
      .all()
  }

  child(parentContextId: string, nativeThreadId: string, toolCallId: string, name: string): AgentSessionContextRow {
    const child = application.get('DbService').withWriteTx((tx) => {
      const parent = tx.select().from(contexts).where(eq(contexts.id, parentContextId)).get()
      if (!parent) throw new Error('Parent context is unavailable')
      const found = tx
        .select()
        .from(contexts)
        .where(and(eq(contexts.parentContextId, parentContextId), eq(contexts.nativeThreadId, nativeThreadId)))
        .get()
      if (found) return found
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
    const ownerSessionId = application
      .get('DbService')
      .getDb()
      .select({ ownerSessionId: sessions.ownerSessionId })
      .from(sessions)
      .where(eq(sessions.id, child.sessionId))
      .get()?.ownerSessionId
    if (ownerSessionId) this.childCreated.fire({ ownerSessionId })
    return child
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
      Partial<Pick<AgentSessionContextRow, 'id' | 'nativeThreadId' | 'checkpointMapping'>>
  ): AgentSessionContextRow {
    this.backendTx(tx, binding.backendId)
    if (!binding.anchorMessageId) throw new Error('Branch anchor is required')
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
    const context = this.branchTx(tx, sessionId, getAgentSessionHead(tx, sessionId)!)
    if (context?.nativeThreadId !== nativeId) throw new Error('Native edit identity does not match the selected branch')
    tx.update(contexts)
      .set({ nativeThreadId: nativeId, bindingState: 'bound', checkpointMapping: { fork: checkpointMapping } })
      .where(eq(contexts.id, context.id))
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
}

export const agentSessionContextService = new AgentSessionContextService()
import path from 'node:path'
