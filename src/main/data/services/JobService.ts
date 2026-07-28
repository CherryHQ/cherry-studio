import { application } from '@application'
import { type InsertJobRow, type JobRow, jobTable } from '@data/db/schemas/job'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import {
  ACTIVE_JOB_STATUSES,
  type JobError,
  JobErrorSchema,
  type JobSnapshot,
  type JobStatus,
  TERMINAL_JOB_STATUSES
} from '@shared/data/api/schemas/jobs'
import { and, asc, count, desc, eq, inArray, lte, type SQL } from 'drizzle-orm'

const logger = loggerService.withContext('JobService')

export interface JobListFilter {
  status?: JobStatus[]
  queue?: string
  /** Single type (`eq`) or a set (`inArray`). An empty array means "no filter" (matches the `status` convention). */
  type?: string | string[]
  scheduleId?: string
  parentId?: string
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

  /**
   * WHERE composition shared by `list()` and `count()` — keeps the
   * `count(f) === list(f).length` contract structural instead of mirrored by hand.
   * Empty arrays (`status: []`, `type: []`) mean "no filter".
   */
  private listConditions(filter: Omit<JobListFilter, 'limit' | 'offset'>): SQL[] {
    const conditions: SQL[] = []
    if (filter.status?.length) conditions.push(inArray(jobTable.status, filter.status))
    if (filter.queue) conditions.push(eq(jobTable.queue, filter.queue))
    if (Array.isArray(filter.type)) {
      if (filter.type.length) conditions.push(inArray(jobTable.type, filter.type))
    } else if (filter.type) {
      conditions.push(eq(jobTable.type, filter.type))
    }
    if (filter.scheduleId) conditions.push(eq(jobTable.scheduleId, filter.scheduleId))
    if (filter.parentId) conditions.push(eq(jobTable.parentId, filter.parentId))
    return conditions
  }

  list(filter: JobListFilter = {}): JobSnapshot[] {
    const db = this.getDb()
    const conditions = this.listConditions(filter)

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
          ? baseQuery.limit(filter.limit).offset(filter.offset).all()
          : baseQuery.limit(filter.limit).all()
        : baseQuery.all()

    return rows.map((r) => this.rowToSnapshot(r))
  }

  /**
   * Total count of jobs matching the same filter shape as `list()`. WHERE
   * composition mirrors `list()` so `count(f) === list(f).length` when no
   * pagination is applied.
   */
  count(filter: Omit<JobListFilter, 'limit' | 'offset'> = {}): number {
    const db = this.getDb()
    const conditions = this.listConditions(filter)

    const query = conditions.length
      ? db
          .select({ count: count() })
          .from(jobTable)
          .where(and(...conditions))
      : db.select({ count: count() }).from(jobTable)

    const [r] = query.all()
    return r?.count ?? 0
  }

  getById(id: string): JobSnapshot | null {
    const [row] = this.getDb().select().from(jobTable).where(eq(jobTable.id, id)).limit(1).all()
    return row ? this.rowToSnapshot(row) : null
  }

  /**
   * Find any non-terminal job with the given idempotency key. JobManager.enqueue
   * calls this for cross-restart deduplication: if a result is returned, reuse
   * the existing job's handle instead of creating a new row.
   */
  findActiveByIdempotencyKey(key: string): JobSnapshot | null {
    return this.findActiveByIdempotencyKeyTx(this.getDb(), key)
  }

  /**
   * The last N terminal jobs for a schedule, ordered by finishedAt DESC.
   * Used by handler.onSettled to implement circuit-breaker logic without a
   * separate tracker table — jobTable is the single source of truth.
   */
  listRecentTerminalByScheduleId(scheduleId: string, limit: number): JobSnapshot[] {
    const rows = this.getDb()
      .select()
      .from(jobTable)
      .where(and(eq(jobTable.scheduleId, scheduleId), inArray(jobTable.status, TERMINAL_JOB_STATUSES)))
      .orderBy(desc(jobTable.finishedAt))
      .limit(limit)
      .all()
    return rows.map((r) => this.rowToSnapshot(r))
  }

  // ---------------- Write (non-tx thin wrappers over Tx versions) ----------------

  /**
   * Non-tx write methods in this section are thin wrappers over their `*Tx`
   * counterparts, passing the bare connection — a single statement is atomic
   * on better-sqlite3's one connection and needs no explicit transaction.
   *
   * Use the `*Tx` versions directly when composing multiple writes into one
   * transaction (recovery, batch operations, `JobManager.enqueueTx`).
   */

  create(dto: InsertJobRow): JobSnapshot {
    return this.createTx(this.getDb(), dto)
  }

  // ---------------- Tx-scoped (inside JobManager.dispatch transaction) ----------------

  /**
   * Insert a job row inside the caller's transaction. `withSqliteErrors` lives
   * here so both `create` and transactional callers surface typed errors
   * (e.g. an idempotency-key unique violation).
   */
  createTx(tx: DbOrTx, dto: InsertJobRow): JobSnapshot {
    const result = withSqliteErrors(
      () => tx.insert(jobTable).values(dto).returning().all(),
      defaultHandlersFor('Job', dto.id ?? '<auto>')
    )
    const row = result[0]
    if (!row) throw new Error('jobService.create returned no row')
    return this.rowToSnapshot(row)
  }

  /**
   * `findActiveByIdempotencyKey` reading through the caller's transaction, so
   * `JobManager.enqueueTx` sees a consistent view of the key within its tx.
   */
  findActiveByIdempotencyKeyTx(tx: DbOrTx, key: string): JobSnapshot | null {
    const [row] = tx
      .select()
      .from(jobTable)
      .where(and(eq(jobTable.idempotencyKey, key), inArray(jobTable.status, ACTIVE_JOB_STATUSES)))
      .limit(1)
      .all()
    return row ? this.rowToSnapshot(row) : null
  }

  /**
   * Count currently-running jobs for a queue — checks queue concurrency.
   * Only `running` counts toward the cap: pending/delayed jobs are queued or
   * waiting on backoff and occupy no worker slot (mirrors `countRunningGlobalTx`).
   * Counting them would deadlock the queue once its backlog reaches concurrency.
   */
  countRunningByQueueTx(tx: DbOrTx, queue: string): number {
    const [r] = tx
      .select({ count: count() })
      .from(jobTable)
      .where(and(eq(jobTable.queue, queue), eq(jobTable.status, 'running')))
      .all()
    return r?.count ?? 0
  }

  /**
   * Count currently-running jobs across all queues — checks globalMaxConcurrency.
   * Only `running` counts toward the global cap: pending/delayed do not occupy
   * worker slots.
   */
  countRunningGlobalTx(tx: DbOrTx): number {
    const [r] = tx.select({ count: count() }).from(jobTable).where(eq(jobTable.status, 'running')).all()
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
  claimNextPendingTx(tx: DbOrTx, queue: string): JobRow | null {
    const now = Date.now()
    const [candidate] = tx
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
      .all()
    if (!candidate) return null

    const updated = tx
      .update(jobTable)
      .set({ status: 'running', startedAt: now, updatedAt: now })
      .where(and(eq(jobTable.id, candidate.id), eq(jobTable.status, 'pending'), eq(jobTable.cancelRequested, false)))
      .returning()
      .all()
    return updated[0] ?? null
  }

  /** Move a job to a terminal state, persisting output and/or error. */
  setTerminalTx(
    tx: DbOrTx,
    jobId: string,
    status: 'completed' | 'failed' | 'cancelled',
    output: unknown | undefined,
    error: JobError | null
  ): void {
    const now = Date.now()
    tx.update(jobTable)
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
      .run()
  }

  /**
   * Re-schedule a failed job for retry. Caller computes `scheduledAt = now + backoff(attempt+1)`.
   * Resets startedAt; preserves output/scheduleId/idempotencyKey.
   */
  setDelayedRetryTx(tx: DbOrTx, jobId: string, attempt: number, scheduledAt: number, error: JobError | null): void {
    const now = Date.now()
    tx.update(jobTable)
      .set({
        status: 'delayed',
        attempt,
        scheduledAt,
        startedAt: null,
        updatedAt: now,
        error
      })
      .where(eq(jobTable.id, jobId))
      .run()
  }

  setCancelRequestedTx(tx: DbOrTx, jobId: string): void {
    const now = Date.now()
    tx.update(jobTable).set({ cancelRequested: true, updatedAt: now }).where(eq(jobTable.id, jobId)).run()
  }

  /**
   * Atomically replace jobTable.metadata. Used by JobContext.patchMetadata to
   * persist cross-restart state (e.g. remote-poll providerTaskId). Caller
   * passes the merged object — drizzle's JSON column serializes it.
   */
  setMetadataTx(tx: DbOrTx, jobId: string, metadata: Record<string, unknown>): void {
    const now = Date.now()
    tx.update(jobTable).set({ metadata, updatedAt: now }).where(eq(jobTable.id, jobId)).run()
  }

  // ---------------- Startup recovery (JobManager.onReady) ----------------

  /** All jobs currently marked `running` — typically orphans from a crash. */
  getStaleRunning(): JobRow[] {
    return this.getDb().select().from(jobTable).where(eq(jobTable.status, 'running')).all()
  }

  /**
   * All non-terminal jobs across statuses. Recovery uses this for the orphan
   * sweep — a row whose `type` has no registered handler should be cancelled
   * regardless of whether it's running, pending, or delayed. Without this a
   * delayed orphan would silently sit forever (no handler to ever run it,
   * no timer to surface it).
   */
  getStaleActive(): JobRow[] {
    return this.getDb().select().from(jobTable).where(inArray(jobTable.status, ACTIVE_JOB_STATUSES)).all()
  }

  /**
   * All non-terminal jobs for a type, sorted newest first — singleton
   * recovery uses this. `id DESC` is appended as a tiebreaker because
   * `createdAt` resolution is milliseconds and two rows created in the same
   * ms would otherwise leave SQLite's row order implementation-defined.
   * uuidv7 ids are lexicographically monotonic within a millisecond so this
   * gives a deterministic "newest" pick.
   */
  getActiveByType(type: string): JobRow[] {
    return this.getDb()
      .select()
      .from(jobTable)
      .where(and(eq(jobTable.type, type), inArray(jobTable.status, ACTIVE_JOB_STATUSES)))
      .orderBy(desc(jobTable.createdAt), desc(jobTable.id))
      .all()
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
  getDistinctActiveQueues(): Array<{ queue: string; type: string }> {
    return this.getDb()
      .select({ queue: jobTable.queue, type: jobTable.type })
      .from(jobTable)
      .where(inArray(jobTable.status, ACTIVE_JOB_STATUSES))
      .groupBy(jobTable.queue, jobTable.type)
      .all()
  }

  resetToPendingByIdsTx(tx: DbOrTx, jobIds: string[]): void {
    if (jobIds.length === 0) return
    const now = Date.now()
    tx.update(jobTable)
      .set({ status: 'pending', startedAt: null, updatedAt: now })
      .where(inArray(jobTable.id, jobIds))
      .run()
  }

  resetToPendingByIds(jobIds: string[]): void {
    if (jobIds.length === 0) return
    this.resetToPendingByIdsTx(application.get('DbService').getDb(), jobIds)
  }

  cancelByIdsTx(tx: DbOrTx, jobIds: string[], error: JobError | null): void {
    if (jobIds.length === 0) return
    const now = Date.now()
    tx.update(jobTable)
      .set({
        status: 'cancelled',
        finishedAt: now,
        updatedAt: now,
        error
      })
      .where(inArray(jobTable.id, jobIds))
      .run()
  }

  cancelByIds(jobIds: string[], error: JobError | null): void {
    if (jobIds.length === 0) return
    this.cancelByIdsTx(application.get('DbService').getDb(), jobIds, error)
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
  cancelManyTx(
    tx: DbOrTx,
    filter: { queue?: string; type?: string },
    error: JobError | null
  ): { runningIds: string[]; transitioned: number } {
    const conditions: SQL[] = [inArray(jobTable.status, ACTIVE_JOB_STATUSES)]
    if (filter.queue) conditions.push(eq(jobTable.queue, filter.queue))
    if (filter.type) conditions.push(eq(jobTable.type, filter.type))

    const matching = tx
      .select()
      .from(jobTable)
      .where(and(...conditions))
      .all()
    const runningIds = matching.filter((r) => r.status === 'running').map((r) => r.id)
    const nonRunningIds = matching.filter((r) => r.status !== 'running').map((r) => r.id)

    const now = Date.now()
    if (runningIds.length) {
      tx.update(jobTable).set({ cancelRequested: true, updatedAt: now }).where(inArray(jobTable.id, runningIds)).run()
    }
    let transitioned = 0
    if (nonRunningIds.length) {
      const result = tx
        .update(jobTable)
        .set({
          status: 'cancelled',
          finishedAt: now,
          updatedAt: now,
          error
        })
        .where(inArray(jobTable.id, nonRunningIds))
        .run()
      transitioned = result.changes
    }
    return { runningIds, transitioned }
  }

  // ---------------- Delayed → pending promotion ----------------

  /**
   * Promote delayed jobs whose `scheduledAt` has passed into `pending` so the
   * dispatch loop picks them up. Returns the count of rows promoted.
   *
   * The `WHERE status='delayed'` guard is intrinsic — only delayed rows are
   * promotion candidates — so the operation is naturally idempotent.
   */
  promoteDelayedDueTx(tx: DbOrTx, now: number): number {
    const result = tx
      .update(jobTable)
      .set({ status: 'pending', updatedAt: now })
      .where(and(eq(jobTable.status, 'delayed'), lte(jobTable.scheduledAt, now)))
      .run()
    return result.changes
  }

  promoteDelayedDue(now: number): number {
    return this.promoteDelayedDueTx(application.get('DbService').getDb(), now)
  }

  // ---------------- GC ----------------

  /** Delete terminal jobs whose finishedAt is older than the cutoff. */
  pruneTerminalOlderThanTx(tx: DbOrTx, cutoffMs: number): number {
    const result = tx
      .delete(jobTable)
      .where(and(inArray(jobTable.status, TERMINAL_JOB_STATUSES), lte(jobTable.finishedAt, cutoffMs)))
      .run()
    return result.changes
  }

  pruneTerminalOlderThan(cutoffMs: number): number {
    return this.pruneTerminalOlderThanTx(application.get('DbService').getDb(), cutoffMs)
  }

  /**
   * Keep only the latest `keepPerType` terminal jobs per type; delete the rest.
   * At Phase 1 scale (thousands of terminal rows total) this in-memory pass is
   * cheaper than a window-function SQL and portable across SQLite versions.
   */
  pruneTerminalKeepLatestPerTypeTx(tx: DbOrTx, keepPerType: number): number {
    const allTerminal = tx
      .select({ id: jobTable.id, type: jobTable.type })
      .from(jobTable)
      .where(inArray(jobTable.status, TERMINAL_JOB_STATUSES))
      .orderBy(desc(jobTable.finishedAt))
      .all()

    const perType = new Map<string, number>()
    const toDelete: string[] = []
    for (const row of allTerminal) {
      const c = (perType.get(row.type) ?? 0) + 1
      perType.set(row.type, c)
      if (c > keepPerType) toDelete.push(row.id)
    }
    if (toDelete.length === 0) return 0
    const result = tx.delete(jobTable).where(inArray(jobTable.id, toDelete)).run()
    return result.changes
  }

  pruneTerminalKeepLatestPerType(keepPerType: number): number {
    const dbService = application.get('DbService')
    return dbService.withWriteTx((tx) => this.pruneTerminalKeepLatestPerTypeTx(tx, keepPerType))
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
