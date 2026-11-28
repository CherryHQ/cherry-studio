import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
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
  type AgentSessionCheckpoints,
  type ClaudeCodeReplayEntry
} from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'

import { ensureAgentSessionRootTx, getAgentSessionHead, readAgentSessionAncestry } from './agentSessionMessageTree'
import { agentSessionService } from './AgentSessionService'

const locatorSchema = z.discriminatedUnion('kind', [
  z.object({ version: z.literal(1), kind: z.literal('local') }),
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
  private claudeCodeReplayContext(tx: DbOrTx, sessionId: string) {
    return tx
      .select({ id: contexts.id, checkpoint: contexts.checkpointMapping })
      .from(contexts)
      .innerJoin(backends, eq(backends.id, contexts.backendId))
      .where(
        and(
          eq(contexts.sessionId, sessionId),
          isNull(contexts.parentContextId),
          sql`json_extract(${backends.locator}, '$.kind') = 'claude-code'`
        )
      )
      .orderBy(
        sql`json_type(${contexts.checkpointMapping}, '$.claudeCodeReplay') IS NULL`,
        contexts.createdAt,
        contexts.id
      )
      .limit(1)
      .get()
  }

  readClaudeCodeReplay(sessionId: string) {
    return this.claudeCodeReplayContext(application.get('DbService').getDb(), sessionId)?.checkpoint?.claudeCodeReplay
  }

  saveClaudeCodeReplay(
    sessionId: string,
    states: ReadonlyArray<[string, Exclude<ClaudeCodeReplayEntry, 'ambiguous'>]>
  ): void {
    application.get('DbService').withWriteTx((tx) => {
      const context = this.claudeCodeReplayContext(tx, sessionId)
      if (!context) return
      const claudeCodeReplay = { ...context.checkpoint?.claudeCodeReplay }
      for (const [key, state] of states) {
        // A repeated block with different state has no unambiguous origin.
        claudeCodeReplay[key] =
          !Object.hasOwn(claudeCodeReplay, key) || isDeepStrictEqual(claudeCodeReplay[key], state) ? state : 'ambiguous'
      }
      tx.update(contexts)
        .set({ checkpointMapping: { ...context.checkpoint, claudeCodeReplay } })
        .where(eq(contexts.id, context.id))
        .run()
    })
  }

  removedRootSourceIds(contextId: string): string[] {
    const row = application
      .get('DbService')
      .getDb()
      .select({ removed: sql<string | null>`json_extract(${contexts.checkpointMapping}, '$.root.removed')` })
      .from(contexts)
      .where(eq(contexts.id, contextId))
      .get()
    if (!row) throw new Error('Native context does not exist')
    return row.removed ? JSON.parse(row.removed) : []
  }

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
  backendsNeedingRecovery(): AgentRuntimeBackendRow[] {
    return application
      .get('DbService')
      .getDb()
      .select()
      .from(backends)
      .where(sql`${backends.needsRecoveryCheck} = 1`)
      .all()
  }

  markRecoveryCheck(id: string, needed: boolean): void {
    application
      .get('DbService')
      .getDb()
      .update(backends)
      .set({ needsRecoveryCheck: needed })
      .where(and(eq(backends.id, id), eq(backends.needsRecoveryCheck, !needed)))
      .run()
  }

  rootForThread(backendId: string, nativeThreadId: string): AgentSessionContextRow | undefined {
    const rows = application
      .get('DbService')
      .getDb()
      .select({ context: contexts })
      .from(contexts)
      .innerJoin(sessions, eq(sessions.id, contexts.sessionId))
      .where(
        and(
          eq(contexts.backendId, backendId),
          eq(contexts.nativeThreadId, nativeThreadId),
          isNull(contexts.parentContextId),
          isNull(sessions.deletedAt)
        )
      )
      .limit(2)
      .all()
    return rows.length === 1 ? rows[0].context : undefined
  }

  localRootForThread(sessionId: string, providerId: string, nativeThreadId: string) {
    return application
      .get('DbService')
      .getDb()
      .select({ context: contexts })
      .from(contexts)
      .innerJoin(backends, eq(backends.id, contexts.backendId))
      .innerJoin(sessions, eq(sessions.id, contexts.sessionId))
      .where(
        and(
          eq(contexts.sessionId, sessionId),
          eq(backends.localProviderId, providerId),
          eq(contexts.nativeThreadId, nativeThreadId),
          isNull(contexts.parentContextId),
          isNull(sessions.deletedAt)
        )
      )
      .get()?.context
  }

  roots(backendId: string): AgentSessionContextRow[] {
    return application
      .get('DbService')
      .getDb()
      .select({ context: contexts })
      .from(contexts)
      .innerJoin(sessions, eq(sessions.id, contexts.sessionId))
      .where(
        and(
          eq(contexts.backendId, backendId),
          isNull(contexts.parentContextId),
          isNotNull(contexts.anchorMessageId),
          isNull(sessions.deletedAt)
        )
      )
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

  childArchive(ownerSessionId: string, toolCallId: string) {
    const rows = application
      .get('DbService')
      .getDb()
      .select({
        id: contexts.id,
        sessionId: contexts.sessionId,
        canSubmit:
          sql<boolean>`${contexts.nativeThreadId} IS NOT NULL AND json_extract(${backends.locator}, '$.kind') != 'claude-code'`.mapWith(
            Boolean
          )
      })
      .from(contexts)
      .innerJoin(sessions, eq(sessions.id, contexts.sessionId))
      .innerJoin(backends, eq(backends.id, contexts.backendId))
      .where(and(eq(sessions.ownerSessionId, ownerSessionId), eq(contexts.spawnToolCallId, toolCallId)))
      .limit(2)
      .all()
    return rows.length === 1 ? rows[0] : undefined
  }

  childPageMetadata(contextId: string, messageIds: readonly string[]) {
    type Composition = NonNullable<NonNullable<AgentSessionCheckpoints['child']>['composition']>
    const saved = application.get('DbService').getDb().get<{ gap: string | null; groups: string }>(sql`
      SELECT json_extract(checkpoint_mapping, '$.child.gap') AS gap,
        (SELECT json_group_object(g.key, json(g.value)) FROM json_each(checkpoint_mapping, '$.child.composition') AS g
         WHERE g.key IN (SELECT value FROM json_each(${JSON.stringify(messageIds)}))) AS groups
      FROM agent_session_context WHERE id = ${contextId}
    `)
    return { diagnostic: saved?.gap ?? undefined, composition: JSON.parse(saved?.groups ?? '{}') as Composition }
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
      Partial<
        Pick<AgentSessionContextRow, 'id' | 'nativeThreadId' | 'bindingState' | 'checkpointMapping' | 'localModel'>
      >
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

  detachBranchTx(tx: DbOrTx, contextId: string): void {
    // Retain the context row for historical input and child archive references.
    tx.update(contexts)
      .set({ anchorMessageId: null, nativeThreadId: null, bindingState: 'pending', updatedAt: Date.now() })
      .where(eq(contexts.id, contextId))
      .run()
  }

  rebuildFileBranch(context: AgentSessionContextRow): AgentSessionContextRow {
    return application.get('DbService').withWriteTx((tx) => {
      const anchorMessageId = context.anchorMessageId!
      const current = this.branchTx(tx, context.sessionId, anchorMessageId)
      if (!current) throw new Error('The branch no longer exists')
      if (current.id !== context.id) return current
      this.detachBranchTx(tx, context.id)
      return this.reserveBranchTx(tx, {
        sessionId: context.sessionId,
        backendId: context.backendId,
        anchorMessageId,
        nativeThreadId: uuid(),
        checkpointMapping: { referenceHistory: true }
      })
    })
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
    const context = this.branchTx(tx, sessionId, getAgentSessionHead(tx, sessionId)!)
    if (context?.nativeThreadId !== nativeId) throw new Error('Native edit identity does not match the selected branch')
    const staleResetHandled = context.checkpointMapping?.staleResetHandled
    const claudeCodeReplay = context.checkpointMapping?.claudeCodeReplay
    tx.update(contexts)
      .set({
        nativeThreadId: nativeId,
        bindingState: 'bound',
        checkpointMapping: {
          fork: checkpointMapping,
          ...(staleResetHandled !== undefined ? { staleResetHandled } : {}),
          ...(claudeCodeReplay !== undefined ? { claudeCodeReplay } : {})
        }
      })
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
    if (parsed.kind === 'local') throw new Error('A local backend requires a provider')
    const existing = tx.select().from(backends).where(eq(backends.locator, parsed)).get()
    return existing ?? tx.insert(backends).values({ locator: parsed, state }).returning().get()
  }

  ensureLocalBackendTx(tx: DbOrTx, providerId: string): AgentRuntimeBackendRow {
    const existing = tx.select().from(backends).where(eq(backends.localProviderId, providerId)).get()
    return (
      existing ??
      tx
        .insert(backends)
        .values({ locator: { version: 1, kind: 'local' }, state: 'bound', localProviderId: providerId })
        .returning()
        .get()
    )
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

  setLocalModelTx(tx: DbOrTx, contextId: string, localModel: NonNullable<AgentSessionContextRow['localModel']>) {
    return tx.update(contexts).set({ localModel }).where(eq(contexts.id, contextId)).returning().get()
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
