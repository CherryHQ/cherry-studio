import { application } from '@application'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import {
  type AgentSessionRuntimeStateRow,
  agentSessionRuntimeStateTable
} from '@data/db/schemas/agentSessionRuntimeState'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { and, count, eq, inArray } from 'drizzle-orm'

/**
 * Payload schema version stamped on every write. Reads filter on it, so a
 * future incompatible shape change only needs a bump here — old rows become
 * invisible and the runtime recompacts from durable message history.
 */
export const AGENT_SESSION_RUNTIME_STATE_VERSION = 1

export type SaveAgentSessionRuntimeStateParams = {
  sessionId: string
  runtimeType: string
  compactedThroughMessageId: string
  summary: string
  summaryTokenCount?: number | null
  sourceTokenCount?: number | null
  compactionModelId: string
}

/**
 * Owns the `agent_session_runtime_state` table — the durable compaction
 * checkpoint for Cherry-managed agent runtimes (see the schema docblock).
 *
 * Invalidation contract: deleting any message of a session must clear the
 * session's state in the same write transaction, so deleted content cannot
 * survive inside a summary. `AgentSessionMessageService.deleteSessionMessageTx`
 * calls `invalidateStateTx` to uphold this.
 */
export class AgentSessionRuntimeStateService {
  /**
   * Latest usable state for the session, or `null` when absent, written by a
   * different runtime, or written under a different payload version.
   */
  getState(sessionId: string, runtimeType: string): AgentSessionRuntimeStateRow | null {
    const database = application.get('DbService').getDb()
    const [row] = database
      .select()
      .from(agentSessionRuntimeStateTable)
      .where(
        and(
          eq(agentSessionRuntimeStateTable.sessionId, sessionId),
          eq(agentSessionRuntimeStateTable.runtimeType, runtimeType),
          eq(agentSessionRuntimeStateTable.version, AGENT_SESSION_RUNTIME_STATE_VERSION)
        )
      )
      .limit(1)
      .all()
    return row ?? null
  }

  /** Upsert the session's state (single row per session, single atomic statement). */
  saveState(params: SaveAgentSessionRuntimeStateParams): AgentSessionRuntimeStateRow {
    const database = application.get('DbService').getDb()
    return withSqliteErrors(() => this.upsert(database, params), defaultHandlersFor('Session', params.sessionId))
  }

  /**
   * Guarded upsert for compaction: the summary was generated from a snapshot
   * taken before a long model call, so the write must re-verify — in the same
   * write transaction — that nothing invalidating happened in between.
   * Otherwise a message deleted mid-summarization (whose delete already
   * cleared any old checkpoint) would resurface inside the fresh summary.
   *
   * Returns `null` without writing when the guard fails:
   * - a summarized source row no longer exists, or
   * - the prior state whose summary was folded in was invalidated
   *   (`expectedUpdatedAt` no longer matches the stored row).
   */
  saveStateChecked(
    params: SaveAgentSessionRuntimeStateParams,
    guard: {
      /** `updatedAt` of the state row folded into the new summary, or null when none was. */
      expectedUpdatedAt: number | null
      /** Durable rows embedded in the new summary — all must still exist at commit time. */
      sourceMessageIds: readonly string[]
    }
  ): AgentSessionRuntimeStateRow | null {
    return withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          if (guard.expectedUpdatedAt !== null) {
            const [existing] = tx
              .select({ updatedAt: agentSessionRuntimeStateTable.updatedAt })
              .from(agentSessionRuntimeStateTable)
              .where(eq(agentSessionRuntimeStateTable.sessionId, params.sessionId))
              .limit(1)
              .all()
            if (existing?.updatedAt !== guard.expectedUpdatedAt) return null
          }
          const [{ found }] = tx
            .select({ found: count() })
            .from(agentSessionMessageTable)
            .where(
              and(
                eq(agentSessionMessageTable.sessionId, params.sessionId),
                inArray(agentSessionMessageTable.id, [...guard.sourceMessageIds])
              )
            )
            .all()
          if (found !== guard.sourceMessageIds.length) return null
          return this.upsert(tx, params)
        }),
      defaultHandlersFor('Session', params.sessionId)
    )
  }

  private upsert(db: DbOrTx, params: SaveAgentSessionRuntimeStateParams): AgentSessionRuntimeStateRow {
    const now = Date.now()
    const values = {
      sessionId: params.sessionId,
      runtimeType: params.runtimeType,
      version: AGENT_SESSION_RUNTIME_STATE_VERSION,
      compactedThroughMessageId: params.compactedThroughMessageId,
      summary: params.summary,
      summaryTokenCount: params.summaryTokenCount ?? null,
      sourceTokenCount: params.sourceTokenCount ?? null,
      compactionModelId: params.compactionModelId
    }
    const [row] = db
      .insert(agentSessionRuntimeStateTable)
      .values({ ...values, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: agentSessionRuntimeStateTable.sessionId,
        set: { ...values, updatedAt: now }
      })
      .returning()
      .all()
    return row
  }

  /** Drop the session's state. Runs on the caller's transaction so it commits with the triggering write. */
  invalidateStateTx(tx: DbOrTx, sessionId: string): void {
    tx.delete(agentSessionRuntimeStateTable).where(eq(agentSessionRuntimeStateTable.sessionId, sessionId)).run()
  }
}

export const agentSessionRuntimeStateService = new AgentSessionRuntimeStateService()
