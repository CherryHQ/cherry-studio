import { application } from '@application'
import { type InsertJobRow, type JobRow, jobTable } from '@data/db/schemas/job'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import {
  type JobError,
  JobErrorSchema,
  type JobSnapshot,
  type JobStatus,
  TERMINAL_JOB_STATUSES
} from '@shared/data/api/schemas/jobs'
import { and, asc, count, desc, eq, inArray, lte, type SQL } from 'drizzle-orm'

const logger = loggerService.withContext('JobService')

const NON_TERMINAL_STATUSES = ['pending', 'delayed', 'running'] as const satisfies readonly JobStatus[]

export interface JobListFilter {
  status?: JobStatus[]
  queue?: string
  type?: string
  scheduleId?: string
  limit?: number
  offset?: number
}

/**
 * Owning entity service for `jobTable`. JobManager and DataApi handlers reach
 * the table through this service — no direct Drizzle access elsewhere.
 *
 * Tx-scoped methods (suffix `Tx`) accept a `DbOrTx` so JobManager can call them
 * inside its dispatch transaction (Layer 0 + Layer 1 mutex protect the section).
 * Non-tx methods use the singleton db handle via `this.getDb()`.
 */
export class JobService {
  private getDb(): DbOrTx {
    return application.get('DbService').getDb()
  }

  // ---------------- Read ----------------

  async list(filter: JobListFilter = {}): Promise<JobSnapshot[]> {
    const db = this.getDb()
    const conditions: SQL[] = []
    if (filter.status?.length) conditions.push(inArray(jobTable.status, filter.status))
    if (filter.queue) conditions.push(eq(jobTable.queue, filter.queue))
    if (filter.type) conditions.push(eq(jobTable.type, filter.type))
    if (filter.scheduleId) conditions.push(eq(jobTable.scheduleId, filter.scheduleId))

    const baseQuery = conditions.length
      ? db
          .select()
          .from(jobTable)
          .where(and(...conditions))
          .orderBy(desc(jobTable.createdAt))
      : db.select().from(jobTable).orderBy(desc(jobTable.createdAt))

    const rows =
      filter.limit !== undefined
        ? filter.offset !== undefined
          ? await baseQuery.limit(filter.limit).offset(filter.offset)
          : await baseQuery.limit(filter.limit)
        : await baseQuery

    return rows.map((r) => this.rowToSnapshot(r))
  }

  /**
   * Total count of jobs matching the same filter shape as `list()`. WHERE
   * composition mirrors `list()` so `count(f) === list(f).length` when no
   * pagination is applied.
   */
  async count(filter: Omit<JobListFilter, 'limit' | 'offset'> = {}): Promise<number> {
    const db = this.getDb()
    const conditions: SQL[] = []
    if (filter.status?.length) conditions.push(inArray(jobTable.status, filter.status))
    if (filter.queue) conditions.push(eq(jobTable.queue, filter.queue))
    if (filter.type) conditions.push(eq(jobTable.type, filter.type))
    if (filter.scheduleId) conditions.push(eq(jobTable.scheduleId, filter.scheduleId))

    const query = conditions.length
      ? db
          .select({ count: count() })
          .from(jobTable)
          .where(and(...conditions))
      : db.select({ count: count() }).from(jobTable)

    const [r] = await query
    return r?.count ?? 0
  }

  async getById(id: string): Promise<JobSnapshot | null> {
    const [row] = await this.getDb().select().from(jobTable).where(eq(jobTable.id, id)).limit(1)
    return row ? this.rowToSnapshot(row) : null
  }

  /**
   * Find any non-terminal job with the given idempotency key. JobManager.enqueue
   * calls this for cross-restart deduplication: if a result is returned, reuse
   * the existing job's handle instead of creating a new row.
   */
  async findActiveByIdempotencyKey(key: string): Promise<JobSnapshot | null> {
    const [row] = await this.getDb()
      .select()
      .from(jobTable)
      .where(and(eq(jobTable.idempotencyKey, key), inArray(jobTable.status, NON_TERMINAL_STATUSES)))
      .limit(1)
    return row ? this.rowToSnapshot(row) : null
  }

  /**
   * The last N terminal jobs for a schedule, ordered by finishedAt DESC.
   * Used by handler.onSettled to implement circuit-breaker logic without a
   * separate tracker table — jobTable is the single source of truth.
   */
  async listRecentTerminalByScheduleId(scheduleId: string, limit: number): Promise<JobSnapshot[]> {
    const rows = await this.getDb()
      .select()
      .from(jobTable)
      .where(and(eq(jobTable.scheduleId, scheduleId), inArray(jobTable.status, TERMINAL_JOB_STATUSES)))
      .orderBy(desc(jobTable.finishedAt))
      .limit(limit)
    return rows.map((r) => this.rowToSnapshot(r))
  }

  // ---------------- Write (non-tx) ----------------

  async create(dto: InsertJobRow): Promise<JobSnapshot> {
    const result = await withSqliteErrors(
      () => this.getDb().insert(jobTable).values(dto).returning(),
      defaultHandlersFor('Job', dto.id ?? '<auto>')
    )
    const row = result[0]
    if (!row) throw new Error('jobService.create returned no row')
    return this.rowToSnapshot(row)
  }

  // ---------------- Tx-scoped (inside JobManager.dispatch transaction) ----------------

  /** Count pending+delayed+running jobs for a queue — checks queue concurrency. */
  async countActiveByQueueTx(tx: DbOrTx, queue: string): Promise<number> {
    const [r] = await tx
      .select({ count: count() })
      .from(jobTable)
      .where(and(eq(jobTable.queue, queue), inArray(jobTable.status, NON_TERMINAL_STATUSES)))
    return r?.count ?? 0
  }

  /**
   * Count currently-running jobs across all queues — checks globalMaxConcurrency.
   * Only `running` counts toward the global cap: pending/delayed do not occupy
   * worker slots.
   */
  async countActiveGlobalTx(tx: DbOrTx): Promise<number> {
    const [r] = await tx.select({ count: count() }).from(jobTable).where(eq(jobTable.status, 'running'))
    return r?.count ?? 0
  }

  /**
   * Atomically claim the next pending job in a queue and transition it to
   * running. The double-mutex (Layer 0 global + Layer 1 per-queue) outside this
   * tx ensures no two callers race on the same queue.
   *
   * `cancelRequested=false` is part of the WHERE clause so a cancel() call
   * that flipped the flag while the row was still pending cannot lose the
   * race against dispatch — see the cancel pending→running race fix. The
   * UPDATE re-checks both conditions for belt-and-suspenders correctness.
   */
  async claimNextPendingTx(tx: DbOrTx, queue: string): Promise<JobRow | null> {
    const now = Date.now()
    const [candidate] = await tx
      .select()
      .from(jobTable)
      .where(
        and(
          eq(jobTable.queue, queue),
          eq(jobTable.status, 'pending'),
          eq(jobTable.cancelRequested, false),
          lte(jobTable.scheduledAt, now)
        )
      )
      .orderBy(asc(jobTable.priority), asc(jobTable.scheduledAt))
      .limit(1)
    if (!candidate) return null

    const updated = await tx
      .update(jobTable)
      .set({ status: 'running', startedAt: now, updatedAt: now })
      .where(and(eq(jobTable.id, candidate.id), eq(jobTable.status, 'pending'), eq(jobTable.cancelRequested, false)))
      .returning()
    return updated[0] ?? null
  }

  /** Move a job to a terminal state, persisting output and/or error. */
  async setTerminalTx(
    tx: DbOrTx,
    jobId: string,
    status: 'completed' | 'failed' | 'cancelled',
    output: unknown | undefined,
    error: JobError | null
  ): Promise<void> {
    const now = Date.now()
    await tx
      .update(jobTable)
      .set({
        status,
        finishedAt: now,
        updatedAt: now,
        // Drizzle JSON columns: pass JS value (incl. null) directly; the ORM
        // handles serialization. `undefined` is the "don't update" sentinel,
        // so we explicitly write `null` to clear output when not provided.
        output: output !== undefined ? output : null,
        error
      })
      .where(eq(jobTable.id, jobId))
  }

  /**
   * Re-schedule a failed job for retry. Caller computes `scheduledAt = now + backoff(attempt+1)`.
   * Resets startedAt; preserves output/scheduleId/idempotencyKey.
   */
  async setDelayedRetryTx(
    tx: DbOrTx,
    jobId: string,
    attempt: number,
    scheduledAt: number,
    error: JobError | null
  ): Promise<void> {
    const now = Date.now()
    await tx
      .update(jobTable)
      .set({
        status: 'delayed',
        attempt,
        scheduledAt,
        startedAt: null,
        updatedAt: now,
        error
      })
      .where(eq(jobTable.id, jobId))
  }

  async setCancelRequestedTx(tx: DbOrTx, jobId: string): Promise<void> {
    const now = Date.now()
    await tx.update(jobTable).set({ cancelRequested: true, updatedAt: now }).where(eq(jobTable.id, jobId))
  }

  /**
   * Atomically replace jobTable.metadata. Used by JobContext.patchMetadata to
   * persist cross-restart state (e.g. remote-poll providerTaskId). Caller
   * passes the merged object — drizzle's JSON column serializes it.
   */
  async setMetadataTx(tx: DbOrTx, jobId: string, metadata: Record<string, unknown>): Promise<void> {
    const now = Date.now()
    await tx.update(jobTable).set({ metadata, updatedAt: now }).where(eq(jobTable.id, jobId))
  }

  // ---------------- Startup recovery (JobManager.onReady) ----------------

  /** All jobs currently marked `running` — typically orphans from a crash. */
  async getStaleRunning(): Promise<JobRow[]> {
    return this.getDb().select().from(jobTable).where(eq(jobTable.status, 'running'))
  }

  /**
   * All non-terminal jobs across statuses. Recovery uses this for the orphan
   * sweep — a row whose `type` has no registered handler should be cancelled
   * regardless of whether it's running, pending, or delayed. Without this a
   * delayed orphan would silently sit forever (no handler to ever run it,
   * no timer to surface it).
   */
  async getStaleNonTerminal(): Promise<JobRow[]> {
    return this.getDb().select().from(jobTable).where(inArray(jobTable.status, NON_TERMINAL_STATUSES))
  }

  /**
   * All non-terminal jobs for a type, sorted newest first — singleton
   * recovery uses this. `id DESC` is appended as a tiebreaker because
   * `createdAt` resolution is milliseconds and two rows created in the same
   * ms would otherwise leave SQLite's row order implementation-defined.
   * uuidv7 ids are lexicographically monotonic within a millisecond so this
   * gives a deterministic "newest" pick.
   */
  async getNonTerminalByType(type: string): Promise<JobRow[]> {
    return this.getDb()
      .select()
      .from(jobTable)
      .where(and(eq(jobTable.type, type), inArray(jobTable.status, NON_TERMINAL_STATUSES)))
      .orderBy(desc(jobTable.createdAt), desc(jobTable.id))
  }

  /**
   * Distinct (queue, type) pairs across all non-terminal jobs (pending /
   * delayed / running). JobManager.onAllReady uses this after startup recovery
   * to ensure a DispatchQueue exists for each queue that owns recoverable
   * rows — without this, dispatchAll iterates an empty this.queues Map on
   * cold start and recovered pending rows wait until the next enqueue arrives.
   *
   * `delayed` rows are included so the queue is in place ahead of the next
   * promoteDelayedDue tick. `running` is included for cheap insurance —
   * recovery should have transitioned all running rows to pending or cancelled
   * by the time this runs, but keeping them in the result set is harmless.
   *
   * Returned shape: Array<{ queue, type }>. If multiple types share a queue
   * name (legal — enqueue accepts any string), distinct returns one row per
   * (queue, type). The caller's ensureQueue(queueName, concurrency) keeps the
   * FIRST inserted concurrency value (first-writer-wins). All currently
   * shipped callers use type as queue, so this is a forward-compat note.
   */
  async getDistinctActiveQueues(): Promise<Array<{ queue: string; type: string }>> {
    return this.getDb()
      .select({ queue: jobTable.queue, type: jobTable.type })
      .from(jobTable)
      .where(inArray(jobTable.status, NON_TERMINAL_STATUSES))
      .groupBy(jobTable.queue, jobTable.type)
  }

  async resetToPendingByIds(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return
    const now = Date.now()
    await this.getDb()
      .update(jobTable)
      .set({ status: 'pending', startedAt: null, updatedAt: now })
      .where(inArray(jobTable.id, jobIds))
  }

  async cancelByIds(jobIds: string[], error: JobError | null): Promise<void> {
    if (jobIds.length === 0) return
    const now = Date.now()
    await this.getDb()
      .update(jobTable)
      .set({
        status: 'cancelled',
        finishedAt: now,
        updatedAt: now,
        error
      })
      .where(inArray(jobTable.id, jobIds))
  }

  /**
   * Cancel all non-terminal jobs matching a queue/type filter. Splits targets:
   *   - running rows: mark cancelRequested=true. Caller aborts the in-flight
   *     AbortController; handler observes signal.aborted and terminates;
   *     normal finalize transitions the row to 'cancelled'.
   *   - pending/delayed rows: transition directly to 'cancelled'.
   *
   * Returns `runningIds` (so the caller can abort their controllers) and
   * `transitioned` (count of pending/delayed rows finalized synchronously).
   * Used by JobManager.cancelMany — covers Phase 4 Knowledge reset() and
   * FileProcessing batch cancellation semantics.
   */
  async cancelManyTx(
    tx: DbOrTx,
    filter: { queue?: string; type?: string },
    error: JobError | null
  ): Promise<{ runningIds: string[]; transitioned: number }> {
    const conditions: SQL[] = [inArray(jobTable.status, NON_TERMINAL_STATUSES)]
    if (filter.queue) conditions.push(eq(jobTable.queue, filter.queue))
    if (filter.type) conditions.push(eq(jobTable.type, filter.type))

    const matching = await tx
      .select()
      .from(jobTable)
      .where(and(...conditions))
    const runningIds = matching.filter((r) => r.status === 'running').map((r) => r.id)
    const nonRunningIds = matching.filter((r) => r.status !== 'running').map((r) => r.id)

    const now = Date.now()
    if (runningIds.length) {
      await tx.update(jobTable).set({ cancelRequested: true, updatedAt: now }).where(inArray(jobTable.id, runningIds))
    }
    let transitioned = 0
    if (nonRunningIds.length) {
      const result = await tx
        .update(jobTable)
        .set({
          status: 'cancelled',
          finishedAt: now,
          updatedAt: now,
          error
        })
        .where(inArray(jobTable.id, nonRunningIds))
      transitioned = result.rowsAffected
    }
    return { runningIds, transitioned }
  }

  // ---------------- Delayed → pending promotion ----------------

  /**
   * Promote delayed jobs whose `scheduledAt` has passed into `pending` so the
   * dispatch loop picks them up. Returns the count of rows promoted.
   */
  async promoteDelayedDue(now: number): Promise<number> {
    const result = await this.getDb()
      .update(jobTable)
      .set({ status: 'pending', updatedAt: now })
      .where(and(eq(jobTable.status, 'delayed'), lte(jobTable.scheduledAt, now)))
    return result.rowsAffected
  }

  // ---------------- GC ----------------

  /** Delete terminal jobs whose finishedAt is older than the cutoff. */
  async pruneTerminalOlderThan(cutoffMs: number): Promise<number> {
    const result = await this.getDb()
      .delete(jobTable)
      .where(and(inArray(jobTable.status, TERMINAL_JOB_STATUSES), lte(jobTable.finishedAt, cutoffMs)))
    return result.rowsAffected
  }

  /**
   * Keep only the latest `keepPerType` terminal jobs per type; delete the rest.
   * At Phase 1 scale (thousands of terminal rows total) this in-memory pass is
   * cheaper than a window-function SQL and portable across SQLite versions.
   */
  async pruneTerminalKeepLatestPerType(keepPerType: number): Promise<number> {
    const allTerminal = await this.getDb()
      .select({ id: jobTable.id, type: jobTable.type })
      .from(jobTable)
      .where(inArray(jobTable.status, TERMINAL_JOB_STATUSES))
      .orderBy(desc(jobTable.finishedAt))

    const perType = new Map<string, number>()
    const toDelete: string[] = []
    for (const row of allTerminal) {
      const c = (perType.get(row.type) ?? 0) + 1
      perType.set(row.type, c)
      if (c > keepPerType) toDelete.push(row.id)
    }
    if (toDelete.length === 0) return 0
    const result = await this.getDb().delete(jobTable).where(inArray(jobTable.id, toDelete))
    return result.rowsAffected
  }

  // ---------------- Row → Entity ----------------

  /**
   * Row → entity mapping. Intentionally explicit rather than the
   * `{...nullsToUndefined(row), ...}` skeleton from data-api-in-main.md.
   *
   * JobSnapshot's nullable fields are declared as `.nullable()` (not
   * `.optional()`) so DB NULL → snapshot null cleanly crosses the IPC
   * boundary. `nullsToUndefined` would actively break that — it turns
   * `string | null` into `string | undefined`, forcing every renderer reader
   * to handle a third state. The explicit mapping below preserves the
   * T|null shape directly. notNull columns (id / type / status / queue /
   * scheduledAt / attempt / maxAttempts / cancelRequested / metadata /
   * createdAt / updatedAt) cannot hold NULL at the DB level, so there is
   * nothing for `nullsToUndefined` to translate anyway.
   */
  rowToSnapshot(row: JobRow): JobSnapshot {
    // Drizzle's `text({ mode: 'json' })` columns return parsed JS values:
    // input / output / metadata are already typed; error is `JobError | null`.
    // `validateError` still runs because drizzle only checks JSON syntax,
    // not schema shape (schema drift between app versions can leak through).
    return {
      id: row.id,
      type: row.type,
      status: row.status as JobStatus,
      priority: row.priority,
      queue: row.queue,
      idempotencyKey: row.idempotencyKey,
      scheduleId: row.scheduleId,
      scheduledAt: timestampToISO(row.scheduledAt),
      startedAt: row.startedAt != null ? timestampToISO(row.startedAt) : null,
      finishedAt: row.finishedAt != null ? timestampToISO(row.finishedAt) : null,
      attempt: row.attempt,
      maxAttempts: row.maxAttempts,
      input: row.input,
      output: row.output ?? null,
      error: row.error != null ? this.validateError(row.id, row.error) : null,
      parentId: row.parentId,
      cancelRequested: row.cancelRequested,
      metadata: row.metadata,
      timeoutMs: row.timeoutMs,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  /**
   * Best-effort validate `error` shape against JobErrorSchema. On failure
   * (schema drift, manual SQL edit) log a warn and return a sentinel so
   * renderer code still receives a typed value rather than a structurally-
   * invalid object.
   */
  private validateError(rowId: string, parsed: unknown): JobError | null {
    if (parsed == null) return null
    const result = JobErrorSchema.safeParse(parsed)
    if (result.success) return result.data
    logger.warn('Job error column failed schema validation — using sentinel', {
      rowId,
      issues: result.error.issues.map((i) => i.message)
    })
    return {
      code: 'JOB_CORRUPT_ERROR_ROW',
      message: 'Persisted error column did not match JobErrorSchema',
      retryable: false
    }
  }
}

export const jobService = new JobService()
