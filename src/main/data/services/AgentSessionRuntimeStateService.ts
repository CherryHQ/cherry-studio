import { application } from '@application'
import {
  type AgentSessionRuntimeStateRow,
  agentSessionRuntimeStateTable
} from '@data/db/schemas/agentSessionRuntimeState'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { and, eq } from 'drizzle-orm'

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
    return withSqliteErrors(
      () => {
        const [row] = database
          .insert(agentSessionRuntimeStateTable)
          .values({ ...values, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: agentSessionRuntimeStateTable.sessionId,
            set: { ...values, updatedAt: now }
          })
          .returning()
          .all()
        return row
      },
      defaultHandlersFor('Session', params.sessionId)
    )
  }

  /** Drop the session's state. Runs on the caller's transaction so it commits with the triggering write. */
  invalidateStateTx(tx: DbOrTx, sessionId: string): void {
    tx.delete(agentSessionRuntimeStateTable).where(eq(agentSessionRuntimeStateTable.sessionId, sessionId)).run()
  }
}

export const agentSessionRuntimeStateService = new AgentSessionRuntimeStateService()
