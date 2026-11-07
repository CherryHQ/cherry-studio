import path from 'node:path'

import { and, eq, inArray, sql } from 'drizzle-orm'
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
  type AgentSessionCheckpoints,
  type AgentSessionContextRow
} from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'

import { ensureAgentSessionRootTx, readAgentSessionAncestry } from './agentSessionMessageTree'
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

  removeRootMessageTx(tx: DbOrTx, sessionId: string, messageId: string): void {
    for (const context of tx.select().from(contexts).where(eq(contexts.sessionId, sessionId)).all()) {
      const root = context.checkpointMapping?.root
      if (!root) continue
      const deleted = Object.keys(root.sources).filter((id) => root.sources[id].messageId === messageId)
      if (!deleted.length) continue
      this.saveRootProjectionTx(tx, sessionId, {
        contextId: context.id,
        root: { ...root, removed: [...root.removed, ...deleted] }
      })
    }
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
    return application.get('DbService').withWriteTx((tx) => {
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
    // Respect a stale-resume reset boundary: a failed branch reconnects fresh
    // instead of falling back to a healthy ancestor's native binding, while
    // sibling branches (whose paths exclude the boundary row) are untouched
    // (#23519 review).
    const effectivePath = this.effectivePathTx(tx, sessionId, path)
    return effectivePath
      .toReversed()
      .map((row) => bindings.find((binding) => binding.anchorMessageId === row.id))
      .find((binding) => binding !== undefined)
  }

  /**
   * Whether the ancestry for `messageId` contains a stale-resume reset boundary.
   * Allocation uses this to anchor a fresh branch at the failed head instead of
   * reusing the hidden root anchor (which would violate
   * `agent_session_context_anchor_uniq`). Sibling paths exclude the boundary row,
   * so they keep resolving to the retained root binding (#23519 review).
   */
  hasStaleResetBoundaryTx(tx: DbOrTx, sessionId: string, messageId: string): boolean {
    return this.lastStaleResetBoundaryTx(tx, sessionId, messageId) !== undefined
  }

  /**
   * Last stale-resume reset boundary in the ancestry for `messageId`, if any.
   * Rotation uses the id to limit in-place rewrites to the invalidated binding:
   * once a context records this boundary in
   * `checkpointMapping.staleResetHandled`, later native changes (e.g. `/clear`
   * on a descendant) fork a separate context instead of rewriting the healthy
   * recovered one (#23519 review).
   */
  lastStaleResetBoundaryTx(tx: DbOrTx, sessionId: string, messageId: string): string | undefined {
    const path = readAgentSessionAncestry(tx, sessionId, messageId)
    if (path.length === 0) return undefined
    try {
      const flags = tx
        .select({
          id: messages.id,
          reset: sql<number | null>`json_extract(${messages.data}, '$.staleResumeReset')`
        })
        .from(messages)
        .where(
          and(
            eq(messages.sessionId, sessionId),
            inArray(
              messages.id,
              path.map((row) => row.id)
            )
          )
        )
        .all()
      const resetIds = new Set(flags.filter((flag) => flag.reset).map((flag) => flag.id))
      if (resetIds.size === 0) return undefined
      const lastReset = path.map((row) => (resetIds.has(row.id) ? 1 : 0)).lastIndexOf(1)
      return lastReset >= 0 ? path[lastReset].id : undefined
    } catch {
      return undefined
    }
  }

  private effectivePathTx(tx: DbOrTx, sessionId: string, path: { id: string; parentId: string | null }[]) {
    let effectivePath = path
    if (path.length > 0) {
      try {
        const flags = tx
          .select({
            id: messages.id,
            reset: sql<number | null>`json_extract(${messages.data}, '$.staleResumeReset')`
          })
          .from(messages)
          .where(
            and(
              eq(messages.sessionId, sessionId),
              inArray(
                messages.id,
                path.map((row) => row.id)
              )
            )
          )
          .all()
        const resetIds = new Set(flags.filter((flag) => flag.reset).map((flag) => flag.id))
        if (resetIds.size > 0) {
          const lastReset = path.map((row) => (resetIds.has(row.id) ? 1 : 0)).lastIndexOf(1)
          if (lastReset >= 0) effectivePath = path.slice(lastReset)
        }
      } catch {
        // Best-effort: on read failure fall back to the full path so a stale
        // reset degrades to the previous ancestor-fallback behavior.
      }
    }
    return effectivePath
  }

  /**
   * Rotate a reset-bound branch to a fresh native identity without moving its
   * anchor. Used when `branchTx` still finds a binding at/below the
   * stale-resume reset boundary (e.g. an edit-fork row anchored at the failed
   * head): reusing its dead `nativeThreadId` would fail identically, and
   * inserting a second row at the same anchor would violate
   * `agent_session_context_anchor_uniq`. The row id and anchor are preserved so
   * sibling branches (different anchors) are untouched. Records the handled
   * boundary so later native changes (e.g. `/clear` on a descendant) fork a
   * separate context instead of rewriting the healthy recovered one (#23519
   * review).
   */
  refreshResetBranchTx(
    tx: DbOrTx,
    contextId: string,
    nativeThreadId: string,
    boundaryId?: string
  ): AgentSessionContextRow {
    const current = this.contextTx(tx, contextId)
    const checkpointMapping =
      boundaryId !== undefined
        ? { ...current.checkpointMapping, staleResetHandled: boundaryId }
        : current.checkpointMapping
    return tx
      .update(contexts)
      .set({ nativeThreadId, bindingState: 'pending', updatedAt: Date.now(), checkpointMapping })
      .where(eq(contexts.id, contextId))
      .returning()
      .get()
  }

  publishBranchTx(tx: DbOrTx, sessionId: string, nativeId: string, checkpointMapping: Record<string, unknown>): void {
    const existing = tx
      .select()
      .from(contexts)
      .where(and(eq(contexts.sessionId, sessionId), eq(contexts.nativeThreadId, nativeId)))
      .all()
    for (const row of existing) {
      const staleResetHandled = row.checkpointMapping?.staleResetHandled
      tx.update(contexts)
        .set({
          nativeThreadId: nativeId,
          bindingState: 'bound',
          checkpointMapping: {
            fork: checkpointMapping,
            ...(staleResetHandled !== undefined ? { staleResetHandled } : {})
          }
        })
        .where(eq(contexts.id, row.id))
        .run()
    }
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
