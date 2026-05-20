import { application } from '@application'
import type { InsertJobRow, JobRow } from '@data/db/schemas/job'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { Application } from '@main/core/application/Application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { Disposable } from '@main/core/lifecycle/event'
import {
  JOB_ERROR_CODES,
  type JobError,
  type JobScheduleSnapshot,
  type JobSnapshot,
  type RetryPolicy,
  type Trigger,
  type UpdateJobScheduleDto
} from '@shared/data/api/schemas/jobs'
import { Mutex } from 'async-mutex'

import type { JobPayloadOf, JobType } from './jobRegistry'
import { computeBackoff } from './runtime/backoff'
import { computeCatchUpAction } from './runtime/catchUp'
import { DispatchQueue } from './runtime/DispatchQueue'
import { runStartupRecovery } from './runtime/recovery'
import {
  type EnqueueOptions,
  JOB_PROGRESS_KEY_PREFIX,
  JOB_STATE_KEY_PREFIX,
  type JobContext,
  type JobHandle,
  type JobHandler,
  type JobScheduleRegistrationInput
} from './types'

const logger = loggerService.withContext('JobManager')

/** Default retry policy used when handler does not declare one. */
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoff: 'exponential',
  baseDelayMs: 1000,
  maxDelayMs: 60_000
}

const MAX_INPUT_BYTES = 1_048_576 // 1MB
const MAX_CANCEL_REASON_CHARS = 500

const DEFAULT_GLOBAL_MAX_CONCURRENCY = 50
const DEFAULT_CANCEL_TIMEOUT_MS = 30_000
const GC_INTERVAL_MS = 60 * 60 * 1000 // 1h
const GC_TERMINAL_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const GC_KEEP_PER_TYPE = 100
const DELAYED_PROMOTION_INTERVAL_MS = 5 * 60 * 1000 // 5min

/**
 * Wall-clock delay between `LifecycleManager.allReady()` completing and JobManager
 * running its startup recovery. Lets cold-start IO (DB warm-up, window paints,
 * client-side bootstrap) settle before scheduled work piles on. Hardcoded — the
 * test fixture skips this wait via fake timers.
 */
const JOB_MANAGER_STARTUP_DELAY_MS = 60_000

/**
 * Sentinel thrown via `controller.abort(new JobHandlerTimeoutError())` when a
 * handler's `timeoutMs` elapses. Used instead of string-matching `err.message`
 * so a handler that throws a generic error containing "timeout" cannot be
 * misclassified as a timeout.
 */
class JobHandlerTimeoutError extends Error {
  constructor() {
    super('JobHandlerTimeout')
    this.name = 'JobHandlerTimeoutError'
  }
}

interface FinishedResolver {
  resolve: (snapshot: JobSnapshot) => void
  promise: Promise<JobSnapshot>
}

/**
 * Job orchestration: registers handlers, persists job rows, runs DB-driven
 * dispatch with Layer 0 + Layer 1 mutex, executes handler callbacks, manages
 * 6-state state machine, schedule registry, retry backoff, startup recovery,
 * catch-up detection, GC.
 *
 * See `docs/references/job-and-scheduler/` for the full architecture, the
 * four-layer lock model, and the handler authoring contract.
 *
 * Current shape:
 *   - GC sweep 1h, keep 100 per type, 7-day TTL — promote to per-handler
 *     config once a concrete consumer asks
 *   - globalMaxConcurrency = 50, fixed
 *   - In-process executor only (no worker / child_process pool)
 *   - No DAG / DLQ / priority preemption
 *
 * Lifecycle: only same-phase dependencies are declared here. DbService and
 * CacheService are BeforeReady and ordered automatically by the container.
 */
@Injectable('JobManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['SchedulerService'])
export class JobManager extends BaseService {
  private readonly handlers = new Map<string, JobHandler>()
  private readonly queues = new Map<string, DispatchQueue>()
  private readonly globalDispatchMutex = new Mutex()
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly finishedResolvers = new Map<string, FinishedResolver>()
  /**
   * In-flight execution markers populated by `spawnExecute` regardless of who
   * enqueued the job. Used by `cancel()` to wait for the handler to release —
   * this lives independent of `finishedResolvers` because cross-restart
   * dispatch never builds a `handleFor` entry, leaving the resolver map empty
   * even while a controller is registered.
   */
  private readonly inFlightExecuted = new Map<string, Promise<void>>()
  private readonly scheduleDisposables = new Map<string, Disposable>()
  private readonly globalMaxConcurrency = DEFAULT_GLOBAL_MAX_CONCURRENCY
  /**
   * Flipped to `true` in `onStop` so the in-flight `onAllReady` (which may be
   * sleeping inside the startup-delay timer) can short-circuit on resume
   * instead of triggering recovery against a tearing-down container.
   */
  private _onAllReadyStopRequested = false

  // ---------------- Lifecycle ----------------

  protected override onInit(): void {
    logger.info('JobManager initialized')
  }

  protected override async onReady(): Promise<void> {
    // GC + delayed-promotion ticks live here because they only operate on
    // jobs already in the DB and never invoke business handlers. Anything
    // that depends on a registered handler (startup recovery, schedule
    // arming, dispatching) is deferred to `onAllReady` so business services
    // have had their own `onInit` window to call `registerHandler`.
    this.registerInterval(() => void this.runGC(), GC_INTERVAL_MS)
    this.registerInterval(async () => {
      const promoted = await jobService.promoteDelayedDue(Date.now())
      if (promoted > 0) {
        logger.debug('Promoted delayed jobs', { count: promoted })
        this.dispatchAll()
      }
    }, DELAYED_PROMOTION_INTERVAL_MS)
  }

  /**
   * Runs after every service's `onReady` resolves. Handler registry is
   * guaranteed populated at this point, so it is safe to walk
   * `jobScheduleTable` and arm cron entries without misidentifying schedules
   * as orphans. Each phase is wrapped in its own try/catch so a single
   * failure (e.g. a malformed trigger) cannot leave the session with zero
   * armed schedules.
   */
  protected override async onAllReady(): Promise<void> {
    // Interruptible cold-start delay: `onStop` flips the flag so a teardown
    // arriving during the wait short-circuits the rest of recovery.
    await new Promise<void>((resolve) => setTimeout(resolve, JOB_MANAGER_STARTUP_DELAY_MS))
    if (this._onAllReadyStopRequested) {
      logger.info('onAllReady: stop requested during startup delay, skipping recovery')
      return
    }

    try {
      const stats = await runStartupRecovery(this.handlers)
      logger.info('Startup recovery complete', stats)
    } catch (err) {
      logger.error('Startup recovery failed', err as Error)
    }

    // Catch-up FIRST, then arm. Two reasons:
    //   1. `detectAndDispatchOverdue` reads `lastRun` / `nextRun` from the DB
    //      and is independent of in-process scheduler state — arming order
    //      cannot change its decisions.
    //   2. If we armed first, a cron schedule with `protect: true` could
    //      still fire its natural calendar concurrently with our catch-up
    //      enqueue (protect only blocks overlapping callbacks, not external
    //      callers). Sequencing catch-up before arm guarantees the make-up
    //      enqueue lands before croner's first natural fire.
    let schedules: JobScheduleSnapshot[] = []
    try {
      schedules = await jobScheduleService.listEnabled()
      await this.detectAndDispatchOverdue(schedules)
    } catch (err) {
      logger.error('Overdue detection failed', err as Error)
    }

    for (const schedule of schedules) {
      try {
        this.armSchedule(schedule)
      } catch (err) {
        logger.error('armSchedule failed', err as Error, { scheduleId: schedule.id })
      }
    }

    try {
      this.dispatchAll()
    } catch (err) {
      logger.error('dispatchAll failed', err as Error)
    }

    logger.info('JobManager onAllReady complete', { schedules: schedules.length })
  }

  protected override async onStop(): Promise<void> {
    this._onAllReadyStopRequested = true
    const inFlight = Array.from(this.abortControllers.keys())
    for (const controller of this.abortControllers.values()) {
      controller.abort(new Error('JobManager shutdown'))
    }
    for (const disposable of this.scheduleDisposables.values()) {
      disposable.dispose()
    }
    this.scheduleDisposables.clear()

    if (inFlight.length === 0) {
      logger.info('JobManager.onStop: no in-flight jobs')
    } else {
      const pendingPromises = inFlight
        .map((id) => this.finishedResolvers.get(id)?.promise)
        .filter((p): p is Promise<JobSnapshot> => p !== undefined)

      const timeout = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), Application.SHUTDOWN_TIMEOUT_MS)
      )
      const winner = await Promise.race([Promise.allSettled(pendingPromises).then(() => 'done' as const), timeout])

      if (winner === 'timeout') {
        logger.warn('JobManager.onStop timed out — pending jobs will be recovered on next start', {
          inFlight: inFlight.length,
          timeoutMs: Application.SHUTDOWN_TIMEOUT_MS
        })
      } else {
        logger.info('JobManager.onStop: all in-flight jobs settled')
      }
    }

    // Critical anti-leak: discard unresolved finished resolvers without
    // rejecting their promises. Callers awaiting them keep an unsettled
    // Promise — their responsibility to wrap in a timeout / race.
    this.finishedResolvers.clear()
    this.inFlightExecuted.clear()
    this.abortControllers.clear()
  }

  protected override onDestroy(): void {
    this.handlers.clear()
    this.queues.clear()
    this.abortControllers.clear()
    this.finishedResolvers.clear()
    this.inFlightExecuted.clear()
    this.scheduleDisposables.clear()
  }

  // ---------------- Handler registry ----------------

  /**
   * Register a handler for a JobRegistry type. Must be called from the owning
   * service's `onInit` so the handler is in place before
   * `JobManager.onAllReady`'s startup recovery (which begins ~60s after
   * `LifecycleManager.allReady()` resolves). Registering from a business
   * service's `onAllReady` is unsafe — that hook runs in parallel with
   * `JobManager.onAllReady`, racing against startup recovery and letting
   * existing non-terminal jobs for this type get treated as orphans and
   * cancelled.
   *
   * @param type - JobRegistry key (compile-time validated via declaration merging)
   * @param handler - Handler implementation; `recovery` is required
   * @throws Error if a handler is already registered for `type`
   */
  registerHandler<K extends JobType>(type: K, handler: JobHandler<JobPayloadOf<K>>): void {
    if (this.handlers.has(type)) {
      throw new Error(`JobManager: handler for type "${type}" is already registered`)
    }
    this.handlers.set(type, handler as JobHandler)
    logger.info('Handler registered', { type, recovery: handler.recovery })
  }

  /** True if a handler is registered for `type`. */
  hasHandler(type: string): boolean {
    return this.handlers.has(type)
  }

  // ---------------- enqueue / cancel / list / get ----------------

  /**
   * Persist a new job row and (if status is `pending`) dispatch it. If
   * `opts.idempotencyKey` matches an existing non-terminal job, returns the
   * existing handle without creating a new row. If `opts.scheduledAt` is in
   * the future the row is stored in `delayed` state and a `once` schedule
   * arms its promotion at the target time.
   *
   * @param type - JobRegistry key (compile-time validated via declaration merging)
   * @param input - Strongly-typed payload bound to `type` via JobRegistry
   * @param opts - Optional queue / priority / idempotency / scheduling overrides
   * @returns Handle with `id`, initial `snapshot`, and a `finished` promise
   * @throws Error with code `JOB_UNKNOWN_TYPE` if no handler is registered for `type`
   * @throws Error with code `JOB_PAYLOAD_TOO_LARGE` if input JSON exceeds 1MB
   */
  async enqueue<K extends JobType>(type: K, input: JobPayloadOf<K>, opts: EnqueueOptions = {}): Promise<JobHandle> {
    const handler = this.handlers.get(type)
    if (!handler) {
      throw this.makeError(JOB_ERROR_CODES.UNKNOWN_TYPE, `No handler registered for type "${type}"`, {
        type,
        knownTypes: Array.from(this.handlers.keys())
      })
    }

    // Drizzle serializes JSON columns automatically, but we still need the
    // stringified length for the size guard — the 1MB cap is on the on-disk
    // bytes, not on the live object shape.
    const inputForSizing = input === undefined ? null : input
    const inputJsonLength = JSON.stringify(inputForSizing).length
    if (inputJsonLength > MAX_INPUT_BYTES) {
      throw this.makeError(JOB_ERROR_CODES.PAYLOAD_TOO_LARGE, 'Job input payload exceeds 1MB', {
        type,
        sizeBytes: inputJsonLength
      })
    }

    // Mirror EnqueueJobInputSchema's `min(1)` runtime check — internal TS
    // callers do not get the Zod parse step, so the floor is enforced here so
    // an in-process miscall cannot create a maxAttempts=0 row that never
    // retries and surprises the operator.
    if (opts.maxAttempts !== undefined && (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts < 1)) {
      throw this.makeError('JOB_INVALID_MAX_ATTEMPTS', 'maxAttempts must be an integer >= 1', {
        type,
        value: opts.maxAttempts
      })
    }
    if (opts.timeoutMs !== undefined && (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs < 1)) {
      throw this.makeError('JOB_INVALID_TIMEOUT_MS', 'timeoutMs must be an integer >= 1', {
        type,
        value: opts.timeoutMs
      })
    }

    if (opts.idempotencyKey) {
      const existing = await jobService.findActiveByIdempotencyKey(opts.idempotencyKey)
      if (existing) {
        logger.info('idempotencyKey match — returning existing handle', {
          type,
          key: opts.idempotencyKey,
          existingId: existing.id
        })
        return this.handleFor(existing)
      }
    }

    const queueName = opts.queue ?? handler.defaultQueue?.(input as never) ?? type
    const concurrency = handler.defaultConcurrency ?? 1
    this.ensureQueue(queueName, concurrency)

    const now = Date.now()
    const scheduledAt = opts.scheduledAt ?? now
    const status = scheduledAt > now ? 'delayed' : 'pending'
    const maxAttempts = opts.maxAttempts ?? handler.defaultRetryPolicy?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts

    const insertRow: InsertJobRow = {
      type,
      status,
      priority: opts.priority ?? 0,
      queue: queueName,
      idempotencyKey: opts.idempotencyKey ?? null,
      scheduleId: opts.scheduleId ?? null,
      scheduledAt,
      attempt: 0,
      maxAttempts,
      input: inputForSizing,
      parentId: opts.parentId ?? null,
      cancelRequested: false,
      metadata: opts.metadata ?? {},
      timeoutMs: opts.timeoutMs ?? handler.defaultTimeoutMs ?? null
    }

    const snapshot = await jobService.create(insertRow)
    this.publishState(snapshot)
    const handle = this.handleFor(snapshot)

    if (snapshot.status === 'pending') {
      void this.dispatch(queueName)
    } else if (snapshot.status === 'delayed') {
      this.armDelayedJob(snapshot)
    }

    logger.info('Job enqueued', {
      id: snapshot.id,
      type,
      queue: queueName,
      status: snapshot.status,
      scheduledAt
    })
    return handle
  }

  /**
   * Request cancellation of a single job. For in-flight jobs aborts the
   * AbortController and waits up to `handler.cancelTimeoutMs` (default 30s)
   * for the handler to react — on timeout forces the row to `cancelled` so
   * the dispatch slot frees up. For pending / delayed jobs finalizes
   * directly to `cancelled` without invoking the handler.
   *
   * Already-terminal jobs are a no-op (the row's `cancelRequested` flag is
   * set but the status stays as it was).
   *
   * @param jobId - Target job row id
   * @param reason - Optional human-readable reason, surfaced in the error object
   * @throws Error with code `JOB_CANCEL_REASON_TOO_LONG` if `reason` exceeds 500 chars
   */
  async cancel(jobId: string, reason?: string): Promise<void> {
    if (reason !== undefined && reason.length > MAX_CANCEL_REASON_CHARS) {
      throw this.makeError(JOB_ERROR_CODES.CANCEL_REASON_TOO_LONG, 'Cancel reason exceeds 500 characters', {
        length: reason.length
      })
    }

    const db = application.get('DbService').getDb()
    await db.transaction(async (tx) => {
      await jobService.setCancelRequestedTx(tx, jobId)
    })

    const controller = this.abortControllers.get(jobId)
    if (controller) {
      controller.abort(new Error(`Job cancelled${reason ? `: ${reason}` : ''}`))
      const snapshot = await jobService.getById(jobId)
      const handler = snapshot ? this.handlers.get(snapshot.type) : undefined
      const graceMs = handler?.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS
      // Wait on the executor signal — populated by `spawnExecute` regardless of
      // who enqueued the job, so this works after cross-restart recovery too.
      const executed = this.inFlightExecuted.get(jobId)
      if (executed) {
        const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), graceMs))
        const winner = await Promise.race([executed.then(() => 'done' as const), timeout])
        if (winner === 'timeout') {
          logger.warn('cancel timed out — forcing terminal state', { jobId, graceMs })
          await this.finalizeJob(jobId, 'cancelled', undefined, {
            code: JOB_ERROR_CODES.CANCELLED,
            message: `Cancel timed out after ${graceMs}ms${reason ? ` (reason: ${reason})` : ''}`,
            retryable: false
          })
        }
      }
    } else {
      // Not in-flight — pending / delayed → finalize directly as cancelled.
      // (Once the pending/cancelRequested filter is in claimNextPendingTx,
      // dispatch cannot promote a cancelRequested row to running between the
      // tx above and this branch, so the snapshot here is guaranteed terminal-
      // or-cancellable.)
      const snapshot = await jobService.getById(jobId)
      if (snapshot && (snapshot.status === 'pending' || snapshot.status === 'delayed')) {
        await this.finalizeJob(jobId, 'cancelled', undefined, {
          code: JOB_ERROR_CODES.CANCELLED,
          message: reason ?? 'Cancelled by user',
          retryable: false
        })
      }
    }
  }

  /**
   * Cancel all non-terminal jobs matching the filter. Aborts in-flight
   * AbortControllers in this process and transitions pending / delayed rows
   * directly to `cancelled`. Covers reset() semantics for Phase 4 Knowledge
   * reset and Phase 3 FileProcessing batch cancellation.
   *
   * Running jobs settle asynchronously through the normal handler-execute
   * flow (handler observes `signal.aborted`) and are NOT counted as
   * `transitioned` — only the in-process abort is counted via `aborted`.
   *
   * @param filter - Must specify at least `queue` or `type` (empty filter rejected)
   * @param reason - Optional human-readable reason
   * @returns `aborted`: in-flight controllers aborted; `transitioned`: pending / delayed rows finalized synchronously
   * @throws Error if both `filter.queue` and `filter.type` are undefined
   * @throws Error with code `JOB_CANCEL_REASON_TOO_LONG` if `reason` exceeds 500 chars
   */
  async cancelMany(
    filter: { queue?: string; type?: string },
    reason?: string
  ): Promise<{ aborted: number; transitioned: number }> {
    if (!filter.queue && !filter.type) {
      throw new Error('cancelMany: filter must specify queue or type (empty filter rejected)')
    }
    if (reason !== undefined && reason.length > MAX_CANCEL_REASON_CHARS) {
      throw this.makeError(JOB_ERROR_CODES.CANCEL_REASON_TOO_LONG, 'Cancel reason exceeds 500 characters', {
        length: reason.length
      })
    }
    const db = application.get('DbService').getDb()
    const result = await db.transaction(async (tx) =>
      jobService.cancelManyTx(tx, filter, {
        code: JOB_ERROR_CODES.CANCELLED,
        message: reason ?? 'Cancelled by cancelMany',
        retryable: false
      })
    )
    let aborted = 0
    for (const id of result.runningIds) {
      const controller = this.abortControllers.get(id)
      if (controller) {
        controller.abort(new Error(`Job cancelled${reason ? `: ${reason}` : ''}`))
        aborted++
      }
    }
    return { aborted, transitioned: result.transitioned }
  }

  /**
   * Fetch a single job snapshot by id.
   *
   * @param jobId - Job row id
   * @returns The snapshot, or `null` if the row does not exist
   */
  async get(jobId: string): Promise<JobSnapshot | null> {
    return jobService.getById(jobId)
  }

  /**
   * List job snapshots matching the filter (defaults to all rows).
   *
   * @param filter - Status / type / queue / limit constraints (see `jobService.list`)
   * @returns Matching snapshots ordered by `createdAt DESC`
   */
  async list(filter: Parameters<typeof jobService.list>[0] = {}): Promise<JobSnapshot[]> {
    return jobService.list(filter)
  }

  // ---------------- Schedule registry (dual API: type+name / by id) ----------------

  /**
   * Persist a recurring schedule and arm it on SchedulerService so each fire
   * enqueues a Job of the given type with `jobInputTemplate` as input.
   *
   * @param input - Schedule config (`type`, `trigger`, `jobInputTemplate`, `catchUpPolicy`, optional `name`)
   * @returns `{ id }` — UUID used by all by-id control APIs
   * @throws Error with code `JOB_UNKNOWN_TYPE` if no handler is registered for `input.type`
   * @throws Error with code `JOB_SCHEDULE_NAME_CONFLICT` if `(type, name)` already exists
   * @throws Error with code `JOB_SCHEDULE_SINGLETON_EXISTS` if `name` omitted on a multi-instance type
   */
  async registerJobSchedule<K extends JobType>(input: JobScheduleRegistrationInput<K>): Promise<{ id: string }> {
    if (!this.handlers.has(input.type)) {
      throw this.makeError(JOB_ERROR_CODES.UNKNOWN_TYPE, `No handler for schedule type "${input.type}"`, {
        type: input.type
      })
    }
    const snapshot = await jobScheduleService.create({
      type: input.type,
      name: input.name ?? null,
      trigger: input.trigger,
      jobInputTemplate: input.jobInputTemplate,
      catchUpPolicy: input.catchUpPolicy,
      metadata: input.metadata,
      enabled: input.enabled
    })
    this.armSchedule(snapshot)
    logger.info('Schedule registered', { id: snapshot.id, type: input.type, name: snapshot.name })
    return { id: snapshot.id }
  }

  /**
   * Pause a schedule by id. Stops its SchedulerService timer and sets
   * `enabled=false` in the DB. Pending jobs already enqueued by past fires
   * are unaffected.
   *
   * @param id - Schedule row id (UUID returned by `registerJobSchedule`)
   * @returns `true` if the row existed and was updated; `false` if not found
   */
  async pauseJobScheduleById(id: string): Promise<boolean> {
    const disp = this.scheduleDisposables.get(id)
    if (disp) {
      disp.dispose()
      this.scheduleDisposables.delete(id)
    }
    return jobScheduleService.setEnabled(id, false)
  }

  /**
   * Resume a paused schedule by id. Sets `enabled=true` in the DB and re-arms
   * the SchedulerService timer using the persisted trigger config.
   *
   * @param id - Schedule row id
   * @returns `true` if the row existed and was updated; `false` if not found
   */
  async resumeJobScheduleById(id: string): Promise<boolean> {
    const updated = await jobScheduleService.setEnabled(id, true)
    if (updated) {
      const snapshot = await jobScheduleService.getById(id)
      if (snapshot) this.armSchedule(snapshot)
    }
    return updated
  }

  /**
   * Fire a schedule immediately (extra one-shot — does not affect the natural
   * fire calendar). For cron triggers calls croner's `.trigger()` (the armed
   * callback handles `markFired`). For interval / once triggers or when the
   * SchedulerService entry is missing (e.g. not yet re-armed after restart),
   * enqueues directly using `jobInputTemplate` and writes `markFired`
   * synchronously to keep `lastRun` consistent with the cron path.
   *
   * @param id - Schedule row id
   * @returns `true` if fired; `false` if no schedule exists for `id`
   */
  async triggerJobScheduleNowById(id: string): Promise<boolean> {
    const schedule = await jobScheduleService.getById(id)
    if (!schedule) return false
    const triggered = await application.get('SchedulerService').triggerNow(`schedule:${id}`)
    if (triggered) return true
    // Fallback path (non-cron OR cron not currently armed in this process).
    await this.enqueue(schedule.type as JobType, schedule.jobInputTemplate as never, {
      scheduleId: schedule.id
    })
    try {
      await jobScheduleService.markFired(schedule.id, Date.now(), null)
    } catch (err) {
      logger.warn('markFired failed after manual trigger — lastRun may be stale', {
        scheduleId: schedule.id,
        err: (err as Error).message
      })
    }
    return true
  }

  /**
   * Delete a schedule by id. Disposes its SchedulerService timer and removes
   * the row. Jobs previously enqueued by this schedule keep `scheduleId`
   * referencing the now-deleted row — that linkage is intentional (lets
   * `listRecentTerminalByScheduleId` still find historical jobs).
   *
   * @param id - Schedule row id
   * @returns `true` if the row existed and was deleted; `false` if not found
   */
  async unregisterJobScheduleById(id: string): Promise<boolean> {
    const disp = this.scheduleDisposables.get(id)
    if (disp) {
      disp.dispose()
      this.scheduleDisposables.delete(id)
    }
    return jobScheduleService.delete(id)
  }

  /**
   * Fetch a schedule snapshot by id.
   *
   * @param id - Schedule row id
   * @returns The snapshot, or `null` if the row does not exist
   */
  async getJobScheduleById(id: string): Promise<JobScheduleSnapshot | null> {
    return jobScheduleService.getById(id)
  }

  /**
   * List schedule snapshots matching the filter.
   *
   * @param filter - `type` / `enabled` constraints + `limit` / `offset` paging (see `jobScheduleService.listAll`)
   * @returns Matching snapshots
   */
  async listJobSchedules(
    filter: Parameters<typeof jobScheduleService.listAll>[0] = {}
  ): Promise<JobScheduleSnapshot[]> {
    return jobScheduleService.listAll(filter)
  }

  // By-name flavor — internal resolves to by-id.

  /**
   * Pause a schedule by (type, name). Convenience over `pauseJobScheduleById`
   * when callers know the business-level identity but not the UUID.
   *
   * @param type - JobRegistry key
   * @param name - Schedule name (omit if the type has exactly one schedule)
   * @returns Whether the row was updated (see `pauseJobScheduleById`)
   * @throws Error with code `JOB_SCHEDULE_NAME_REQUIRED` if `type` has multiple schedules and `name` is omitted
   * @throws Error with code `JOB_SCHEDULE_NOT_FOUND_BY_NAME` if `(type, name)` is unknown
   */
  async pauseJobSchedule<K extends JobType>(type: K, name?: string | null): Promise<boolean> {
    const id = await this.resolveScheduleIdByName(type, name)
    return this.pauseJobScheduleById(id)
  }

  /**
   * Resume a schedule by (type, name).
   *
   * @param type - JobRegistry key
   * @param name - Schedule name (omit if the type has exactly one schedule)
   * @returns Whether the row was updated (see `resumeJobScheduleById`)
   * @throws Error with code `JOB_SCHEDULE_NAME_REQUIRED` / `JOB_SCHEDULE_NOT_FOUND_BY_NAME`
   */
  async resumeJobSchedule<K extends JobType>(type: K, name?: string | null): Promise<boolean> {
    const id = await this.resolveScheduleIdByName(type, name)
    return this.resumeJobScheduleById(id)
  }

  /**
   * Fire a schedule immediately by (type, name).
   *
   * @param type - JobRegistry key
   * @param name - Schedule name (omit if the type has exactly one schedule)
   * @returns Whether the schedule was fired (see `triggerJobScheduleNowById`)
   * @throws Error with code `JOB_SCHEDULE_NAME_REQUIRED` / `JOB_SCHEDULE_NOT_FOUND_BY_NAME`
   */
  async triggerJobScheduleNow<K extends JobType>(type: K, name?: string | null): Promise<boolean> {
    const id = await this.resolveScheduleIdByName(type, name)
    return this.triggerJobScheduleNowById(id)
  }

  /**
   * Delete a schedule by (type, name).
   *
   * @param type - JobRegistry key
   * @param name - Schedule name (omit if the type has exactly one schedule)
   * @returns Whether the row was deleted (see `unregisterJobScheduleById`)
   * @throws Error with code `JOB_SCHEDULE_NAME_REQUIRED` / `JOB_SCHEDULE_NOT_FOUND_BY_NAME`
   */
  async unregisterJobSchedule<K extends JobType>(type: K, name?: string | null): Promise<boolean> {
    const id = await this.resolveScheduleIdByName(type, name)
    return this.unregisterJobScheduleById(id)
  }

  /**
   * Update a schedule's persistent config AND re-arm the in-process cron entry
   * when trigger or enabled changes. Required because `jobScheduleService.update`
   * only writes the DB — the in-memory cron entry would otherwise keep firing
   * under the old trigger until the next app restart.
   *
   * The re-arm decision uses field-presence (`patch.trigger !== undefined ||
   * patch.enabled !== undefined`) rather than value-comparison. Callers that
   * include these fields in the patch implicitly opt into a re-arm even when
   * the value is unchanged — cheap and avoids JSON-key-order brittleness in a
   * deep-equal check.
   *
   * Known limitation: the DB write and the in-process re-arm are two awaits
   * apart. Between them an old cron entry can fire once with the old
   * jobInputTemplate. Acceptable trade-off for single-process Electron main —
   * see the design plan for a per-id mutex escalation path.
   *
   * @param id Schedule row id
   * @param patch Partial update
   * @returns Updated snapshot, or null if no row matches `id`
   */
  async updateJobSchedule(id: string, patch: UpdateJobScheduleDto): Promise<JobScheduleSnapshot | null> {
    const updated = await jobScheduleService.update(id, patch)
    if (!updated) return null

    const needsRearm = patch.trigger !== undefined || patch.enabled !== undefined
    if (needsRearm) {
      if (updated.enabled) {
        this.armSchedule(updated)
      } else {
        const disp = this.scheduleDisposables.get(id)
        if (disp) {
          disp.dispose()
          this.scheduleDisposables.delete(id)
        }
      }
    }
    return updated
  }

  /**
   * Fetch a schedule snapshot by (type, name). Unlike the other by-name APIs,
   * a "not found" result returns `null` rather than throwing — convenient for
   * existence checks. `JOB_SCHEDULE_NAME_REQUIRED` is still surfaced when the
   * type has multiple schedules and `name` is omitted.
   *
   * @param type - JobRegistry key
   * @param name - Schedule name (omit if the type has exactly one schedule)
   * @returns The snapshot, or `null` if no row matches `(type, name)`
   * @throws Error with code `JOB_SCHEDULE_NAME_REQUIRED` if `type` has multiple schedules and `name` is omitted
   */
  async getJobSchedule<K extends JobType>(type: K, name?: string | null): Promise<JobScheduleSnapshot | null> {
    const id = await this.resolveScheduleIdByName(type, name).catch((err) => {
      // For "name required" errors, surface them. For "not found", return null.
      if (err instanceof Error && err.message.includes(JOB_ERROR_CODES.SCHEDULE_NOT_FOUND_BY_NAME)) return null
      throw err
    })
    if (typeof id !== 'string') return null
    return jobScheduleService.getById(id)
  }

  private async resolveScheduleIdByName(type: string, name?: string | null): Promise<string> {
    // Map nullish name to the singleton sentinel `''` so the underlying lookup
    // can rely on a uniform string key (DB column is NOT NULL DEFAULT '').
    const nameKey = name ?? ''
    if (name == null) {
      const candidates = await jobScheduleService.listAll({ type })
      if (candidates.length > 1) {
        throw this.makeError(
          JOB_ERROR_CODES.SCHEDULE_NAME_REQUIRED,
          `Type "${type}" has multiple schedules — name required`,
          { type, knownNames: candidates.map((c) => c.name) }
        )
      }
      if (candidates.length === 1) return candidates[0].id
    }
    const snapshot = await jobScheduleService.getByTypeAndName(type, nameKey)
    if (!snapshot) {
      const knownNames = await jobScheduleService.listNamesForType(type)
      throw this.makeError(JOB_ERROR_CODES.SCHEDULE_NOT_FOUND_BY_NAME, `Schedule not found for type "${type}"`, {
        type,
        name: name ?? null,
        knownNames
      })
    }
    return snapshot.id
  }

  // ---------------- Dispatch + execute ----------------

  /**
   * Get or create a DispatchQueue.
   *
   * Concurrency is set at first creation and NOT updated on subsequent calls
   * with the same queueName. Project convention is "one type ↔ one queue ↔
   * one concurrency", so a single owning handler defines the cap and reuse
   * with a different `defaultConcurrency` is a misuse. The first enqueue
   * wins by design; documented for the reader who might be tempted to
   * "fix" it.
   */
  private ensureQueue(name: string, concurrency: number): DispatchQueue {
    let queue = this.queues.get(name)
    if (!queue) {
      queue = new DispatchQueue(name, concurrency)
      this.queues.set(name, queue)
    }
    return queue
  }

  /**
   * Try to claim one pending job in `queueName` and spawn its handler. Releases
   * both mutex layers before invoking the handler. Schedules a microtask
   * recursion to fill the next slot if one was claimed.
   *
   * Lock acquisition order is FIXED: Layer 1 (per-queue) first, Layer 0
   * (global) second. Every call site must use this order so the two layers
   * cannot deadlock against each other.
   *
   * @param queueName - Queue identifier (from `jobTable.queue`); no-op if the queue is unknown
   */
  async dispatch(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName)
    if (!queue) return

    // Layer 1 first (per-queue), then Layer 0 (global libsql tx serializer).
    // Release happens in reverse order in the finally block below.
    const releaseQueue = await queue.mutex.acquire()
    const releaseGlobal = await this.globalDispatchMutex.acquire()
    let claimed: JobRow | null = null

    try {
      const db = application.get('DbService').getDb()
      claimed = await db.transaction(async (tx) => {
        const queueActive = await jobService.countActiveByQueueTx(tx, queueName)
        if (queueActive >= queue.concurrency) return null
        const globalActive = await jobService.countActiveGlobalTx(tx)
        if (globalActive >= this.globalMaxConcurrency) return null
        return jobService.claimNextPendingTx(tx, queueName)
      })
    } catch (err) {
      logger.error('dispatch transaction failed', { queue: queueName, error: err })
    } finally {
      releaseGlobal()
      releaseQueue()
    }

    if (!claimed) return

    // Spawn handler outside of the mutex.
    this.spawnExecute(claimed)
    queueMicrotask(() => void this.dispatch(queueName))
  }

  /**
   * Kick every known queue. Used after startup recovery and after delayed-job
   * promotion, where multiple queues may have new pending rows at once.
   */
  private dispatchAll(): void {
    for (const name of this.queues.keys()) {
      void this.dispatch(name)
    }
  }

  /**
   * Build context, spawn handler.execute, transition state on terminal or
   * schedule retry on retryable failure. Errors thrown synchronously by
   * handler before its first await are caught inside the same task.
   *
   * The handler runs OUTSIDE both dispatch mutexes — execution may take
   * seconds or minutes while other queues continue to dispatch in parallel.
   * The job row is already in `running` state when this method is called
   * (the claim happened inside the dispatch tx), so concurrent dispatchers
   * see the seat occupied via the active-count query.
   *
   * Timeout handling: an unref'd setTimeout aborts the controller when
   * `row.timeoutMs` elapses. The catch branch then classifies the error as
   * `JOB_HANDLER_TIMEOUT` (vs the generic `JOB_HANDLER_THREW`).
   */
  private spawnExecute(row: JobRow): void {
    const handler = this.handlers.get(row.type)
    if (!handler) {
      logger.error('spawnExecute: missing handler — finalizing as failed', { type: row.type, id: row.id })
      void this.finalizeJob(row.id, 'failed', undefined, {
        code: JOB_ERROR_CODES.UNKNOWN_TYPE,
        message: `No handler registered for type "${row.type}"`,
        retryable: false
      })
      return
    }

    const controller = new AbortController()
    this.abortControllers.set(row.id, controller)

    let resolveExecuted!: () => void
    const executed = new Promise<void>((resolve) => {
      resolveExecuted = resolve
    })
    this.inFlightExecuted.set(row.id, executed)

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    if (row.timeoutMs && row.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        controller.abort(new JobHandlerTimeoutError())
      }, row.timeoutMs)
      timeoutHandle.unref?.()
    }

    const initialMetadata = Object.freeze(row.metadata)
    const ctx: JobContext = {
      jobId: row.id,
      input: row.input,
      attempt: row.attempt,
      signal: controller.signal,
      metadata: initialMetadata,
      patchMetadata: async (patch) => {
        // Read latest from row.metadata so sequential patches accumulate.
        // The DB write happens FIRST — if it throws, row.metadata stays in
        // sync with the durable state and the handler observes the failure.
        const merged = { ...row.metadata, ...patch }
        const db = application.get('DbService').getDb()
        await db.transaction(async (tx) => {
          await jobService.setMetadataTx(tx, row.id, merged)
        })
        row.metadata = merged
      },
      reportProgress: (progress, detail) => {
        application.get('CacheService').setShared(`${JOB_PROGRESS_KEY_PREFIX}${row.id}`, { progress, detail }, 60_000)
      },
      logger: loggerService.withContext('JobExec', { jobId: row.id, type: row.type })
    }

    void (async () => {
      try {
        const output = await handler.execute(ctx)
        if (timeoutHandle) clearTimeout(timeoutHandle)
        await this.finalizeJob(row.id, 'completed', output, null)
      } catch (err) {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        // Classify via controller state, not error message — handler errors with
        // strings like "abort" or "timeout" cannot fool the classifier this way.
        const isAbort = controller.signal.aborted
        const abortReason = controller.signal.reason
        const isTimeout = isAbort && abortReason instanceof JobHandlerTimeoutError
        // For user-initiated cancellation the abort reason (built by `cancel()`
        // / `cancelMany()`) holds the human message — prefer it over whatever
        // string the handler chose to throw, so renderers see e.g.
        // "Job cancelled: user requested" instead of a generic "AbortError".
        const cancelMessage = abortReason instanceof Error ? abortReason.message : null
        const error: JobError =
          isAbort && !isTimeout
            ? {
                code: JOB_ERROR_CODES.CANCELLED,
                message: cancelMessage || (err as Error).message || 'Cancelled',
                retryable: false
              }
            : {
                code: isTimeout ? JOB_ERROR_CODES.HANDLER_TIMEOUT : JOB_ERROR_CODES.HANDLER_THREW,
                message: (err as Error).message || String(err),
                retryable: true
              }

        const retryPolicy = handler.defaultRetryPolicy ?? DEFAULT_RETRY_POLICY
        const userCancel = isAbort && !isTimeout
        const canRetry = !userCancel && error.retryable && row.attempt + 1 < row.maxAttempts

        if (canRetry) {
          const backoffMs = computeBackoff(retryPolicy, row.attempt + 1)
          const scheduledAt = Date.now() + backoffMs
          await this.scheduleRetry(row.id, row.attempt + 1, scheduledAt, error, row.queue)
        } else {
          await this.finalizeJob(row.id, userCancel ? 'cancelled' : 'failed', undefined, error)
        }
      } finally {
        this.abortControllers.delete(row.id)
        this.inFlightExecuted.delete(row.id)
        resolveExecuted()
      }
    })()
  }

  /**
   * Terminal-state writer. Persists the final status, publishes the snapshot
   * to the shared cache (renderer subscribers see it instantly), resolves the
   * `JobHandle.finished` promise, invokes `handler.onSettled`, and kicks the
   * queue once more in case another pending job is waiting for the freed slot.
   *
   * If the terminal-write tx fails we synthesize a `failed` snapshot, kick the
   * caller's queue, and resolve any pending handle with the synthetic shape.
   * The DB row stays mismatched until the next process restart's recovery
   * pass — but the in-memory queue slot frees up and `await handle.finished`
   * unblocks instead of stranding the caller.
   */
  private async finalizeJob(
    jobId: string,
    status: 'completed' | 'failed' | 'cancelled',
    output: unknown | undefined,
    error: JobError | null
  ): Promise<void> {
    const db = application.get('DbService').getDb()
    let txFailed: Error | undefined
    try {
      await db.transaction(async (tx) => {
        await jobService.setTerminalTx(tx, jobId, status, output, error)
      })
    } catch (err) {
      txFailed = err as Error
      logger.error('finalizeJob: tx failed — synthesizing failed snapshot to release slot', { jobId, status, err })
    }

    const persisted = await jobService.getById(jobId)
    const snapshot: JobSnapshot | null = persisted ?? (txFailed ? this.synthesizeFailedSnapshot(jobId, txFailed) : null)

    if (!snapshot) {
      // No row persisted AND no synthesis context — extremely rare (GC + delete
      // race after a successful terminal write). Warn and resolve any waiting
      // handle with a synthetic missing-row error to avoid stranding callers.
      logger.warn('finalizeJob: row disappeared after terminal write', { jobId, status })
      const synthetic = this.synthesizeFailedSnapshot(jobId, new Error('row disappeared after terminal write'))
      this.resolveAndDispatch(jobId, synthetic)
      return
    }

    if (!txFailed) this.publishState(snapshot)
    this.resolveAndDispatch(jobId, snapshot)

    const handler = this.handlers.get(snapshot.type)
    if (handler?.onSettled) {
      try {
        await handler.onSettled({
          jobId,
          type: snapshot.type,
          scheduleId: snapshot.scheduleId,
          status: snapshot.status as 'completed' | 'failed' | 'cancelled',
          output: snapshot.output,
          error: snapshot.error,
          attempt: snapshot.attempt
        })
      } catch (settledErr) {
        logger.warn('handler.onSettled threw — ignoring', {
          jobId,
          err: (settledErr as Error).message
        })
      }
    }
  }

  /** Resolve any waiting `JobHandle.finished` and kick the freed queue slot. */
  private resolveAndDispatch(jobId: string, snapshot: JobSnapshot): void {
    const resolver = this.finishedResolvers.get(jobId)
    if (resolver) {
      resolver.resolve(snapshot)
      this.finishedResolvers.delete(jobId)
    }
    void this.dispatch(snapshot.queue)
  }

  /**
   * Build an in-memory failed snapshot for callers awaiting `handle.finished`
   * when the DB write or row-fetch failed. The DB row may still claim
   * `running` until recovery — that's expected; the synthesis only exists to
   * unblock awaiters and free the in-memory slot.
   */
  private synthesizeFailedSnapshot(jobId: string, cause: Error): JobSnapshot {
    const nowIso = new Date().toISOString()
    return {
      id: jobId,
      type: 'unknown',
      status: 'failed',
      priority: 0,
      queue: 'unknown',
      idempotencyKey: null,
      scheduleId: null,
      scheduledAt: nowIso,
      startedAt: null,
      finishedAt: nowIso,
      attempt: 0,
      maxAttempts: 0,
      input: undefined,
      output: null,
      error: {
        code: 'JOB_FINALIZE_TX_FAILED',
        message: cause.message,
        retryable: true
      },
      parentId: null,
      cancelRequested: true,
      metadata: {},
      timeoutMs: null,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  }

  /**
   * Transition a failed job into `delayed` with the next attempt number and
   * future `scheduledAt`. Arms a `once` schedule that promotes `delayed → pending`
   * when the backoff elapses, then re-dispatches the queue. Retry IDs include
   * `attempt` so multiple retries on the same job do not collide in the
   * SchedulerService id map.
   */
  private async scheduleRetry(
    jobId: string,
    nextAttempt: number,
    scheduledAt: number,
    error: JobError,
    queue: string
  ): Promise<void> {
    const db = application.get('DbService').getDb()
    await db.transaction(async (tx) => {
      await jobService.setDelayedRetryTx(tx, jobId, nextAttempt, scheduledAt, error)
    })

    const scheduler = application.get('SchedulerService')
    const retryId = `retry:${jobId}:${nextAttempt}`
    scheduler.registerSchedule(retryId, { kind: 'once', at: scheduledAt }, async () => {
      await jobService.promoteDelayedDue(Date.now())
      void this.dispatch(queue)
    })
    logger.info('Retry scheduled', { jobId, nextAttempt, scheduledAt, queue })
  }

  // ---------------- Schedule arming + catch-up ----------------

  /**
   * Wire a `jobScheduleTable` row into SchedulerService so each fire enqueues
   * a new Job. On every fire `markFired` updates `lastRun` and `nextRun` —
   * those columns drive overdue detection on next startup. A pre-existing
   * disposable for the same id is disposed first (e.g. when a schedule is
   * re-enabled).
   *
   * `markFired` runs unconditionally in a finally block so a deterministic
   * enqueue failure (`JOB_PAYLOAD_TOO_LARGE`, unregistered type, DB
   * constraint) cannot leave `nextRun` stuck null and form an infinite
   * "always overdue → catch-up enqueue → fails again" loop after restart.
   * The error log keeps `{ code, stack }` so Sentry can bucket distinct
   * failure modes instead of flattening to one opaque string.
   */
  private armSchedule(schedule: JobScheduleSnapshot): void {
    if (!schedule.enabled) return
    if (this.scheduleDisposables.has(schedule.id)) {
      this.scheduleDisposables.get(schedule.id)?.dispose()
      this.scheduleDisposables.delete(schedule.id)
    }

    const scheduler = application.get('SchedulerService')
    const scheduleKey = `schedule:${schedule.id}`
    const trigger: Trigger = schedule.trigger
    const disp = scheduler.registerSchedule(scheduleKey, trigger, async () => {
      const firedAt = Date.now()
      try {
        await this.enqueue(schedule.type as JobType, schedule.jobInputTemplate as never, {
          scheduleId: schedule.id
        })
      } catch (err) {
        const e = err as Error & { code?: string }
        logger.error('Schedule fire failed', {
          scheduleId: schedule.id,
          type: schedule.type,
          code: e.code,
          message: e.message,
          stack: e.stack
        })
      } finally {
        try {
          const nextRun = scheduler.getNextRun(scheduleKey)
          await jobScheduleService.markFired(schedule.id, firedAt, nextRun?.getTime() ?? null)
        } catch (markErr) {
          logger.warn('markFired failed — nextRun may be stale', {
            scheduleId: schedule.id,
            err: (markErr as Error).message
          })
        }
      }
    })
    this.scheduleDisposables.set(schedule.id, disp)
  }

  /**
   * Schedule a `once` registration in the Scheduler so the delayed job gets
   * promoted + dispatched at its scheduledAt time. For `pending` jobs this
   * fast-path is skipped — the normal dispatch loop handles them.
   *
   * Uses the reserved `job:${jobId}` SchedulerService id prefix (see the
   * reserved-prefix table in `docs/references/job-and-scheduler/scheduler-usage.md`).
   * The disposable returned by `registerSchedule` is intentionally discarded —
   * cancel() drives termination via the dispatch path rather than disposing
   * the timer, and `scheduleOnce` self-cleans from its map before firing.
   */
  private armDelayedJob(snapshot: JobSnapshot): void {
    const scheduler = application.get('SchedulerService')
    const jobKey = `job:${snapshot.id}`
    const scheduledMs = Date.parse(snapshot.scheduledAt)
    scheduler.registerSchedule(jobKey, { kind: 'once', at: scheduledMs }, async () => {
      await jobService.promoteDelayedDue(Date.now())
      void this.dispatch(snapshot.queue)
    })
  }

  /**
   * Walk every enabled schedule on startup, decide via `computeCatchUpAction`
   * whether each missed its expected fire window, and:
   *   - emit `onMissed` to the handler if defined (observability), AND
   *   - enqueue a make-up job if the schedule's `catchUpPolicy` requested it
   *     (currently `after-startup` is the only enqueuing policy).
   *
   * `skip-missed` still emits `onMissed` — handlers may use it for breaker
   * logic or telemetry even when no make-up job is wanted.
   */
  private async detectAndDispatchOverdue(schedules: JobScheduleSnapshot[]): Promise<void> {
    const nowMs = Date.now()
    for (const schedule of schedules) {
      const handler = this.handlers.get(schedule.type)
      if (!handler) continue
      const action = computeCatchUpAction(schedule, handler, nowMs)
      if (action.missEvent && handler.onMissed) {
        try {
          await handler.onMissed(action.missEvent)
        } catch (err) {
          logger.warn('handler.onMissed threw — ignoring', {
            scheduleId: schedule.id,
            err: (err as Error).message
          })
        }
      }
      if (action.shouldEnqueue) {
        const scheduledAt = nowMs + action.enqueueDelayMs
        await this.enqueue(schedule.type as JobType, schedule.jobInputTemplate as never, {
          scheduleId: schedule.id,
          scheduledAt
        })
        logger.info('Catch-up enqueued', { scheduleId: schedule.id, type: schedule.type, scheduledAt })
      }
    }
  }

  // ---------------- GC ----------------

  /**
   * Prune terminal rows: drop anything older than the 7-day TTL, then drop
   * rows beyond the per-type keep-latest threshold (100). The two steps run
   * in independent try/catch so a single failed prune (table locked, batch
   * too large) does not abort the whole sweep silently — `registerInterval`'s
   * exception isolation prevents a crash but does not log, so each step
   * surfaces its own error.
   */
  private async runGC(): Promise<void> {
    const cutoff = Date.now() - GC_TERMINAL_TTL_MS
    let byTtl = 0
    let byCount = 0
    try {
      byTtl = await jobService.pruneTerminalOlderThan(cutoff)
    } catch (err) {
      logger.error('GC: pruneTerminalOlderThan failed', { err: (err as Error).message })
    }
    try {
      byCount = await jobService.pruneTerminalKeepLatestPerType(GC_KEEP_PER_TYPE)
    } catch (err) {
      logger.error('GC: pruneTerminalKeepLatestPerType failed', { err: (err as Error).message })
    }
    if (byTtl + byCount > 0) {
      logger.info('GC pass', { byTtl, byCount })
    }
  }

  // ---------------- Helpers ----------------

  /**
   * Build a JobHandle for `snapshot`. Three branches:
   *   1. Existing resolver in memory → reuse the same `finished` promise so
   *      multiple `enqueue` calls with the same idempotency key share one.
   *   2. Terminal status → wrap the snapshot in `Promise.resolve` (no resolver
   *      needed; the work is already done).
   *   3. New non-terminal → install a fresh deferred resolver in the map.
   *
   * onStop intentionally does NOT reject these promises — see the anti-leak
   * comment in onStop. Callers awaiting across shutdown must add their own
   * timeout race.
   */
  private handleFor(snapshot: JobSnapshot): JobHandle {
    const existing = this.finishedResolvers.get(snapshot.id)
    if (existing) {
      return { id: snapshot.id, snapshot, finished: existing.promise }
    }
    if (this.isTerminal(snapshot.status)) {
      return { id: snapshot.id, snapshot, finished: Promise.resolve(snapshot) }
    }
    let resolve!: (s: JobSnapshot) => void
    const promise = new Promise<JobSnapshot>((res) => {
      resolve = res
    })
    this.finishedResolvers.set(snapshot.id, { resolve, promise })
    return { id: snapshot.id, snapshot, finished: promise }
  }

  private isTerminal(status: JobSnapshot['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled'
  }

  /** Push a job snapshot to the cross-window shared cache (renderer hooks read this). */
  private publishState(snapshot: JobSnapshot): void {
    application.get('CacheService').setShared(`${JOB_STATE_KEY_PREFIX}${snapshot.id}`, snapshot, 60_000)
  }

  private makeError(code: string, message: string, params?: Record<string, unknown>): Error {
    const err = new Error(`${code}: ${message}`)
    ;(err as Error & { code: string; params?: Record<string, unknown>; retryable: boolean }).code = code
    ;(err as Error & { code: string; params?: Record<string, unknown>; retryable: boolean }).params = params
    ;(err as Error & { code: string; params?: Record<string, unknown>; retryable: boolean }).retryable = false
    return err
  }
}
