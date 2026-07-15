import { application } from '@application'
import type { InsertJobRow, JobRow } from '@data/db/schemas/job'
import type { DbOrTx } from '@data/db/types'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import {
  BaseService,
  DependsOn,
  type Disposable,
  Injectable,
  Phase,
  ServicePhase,
  SHUTDOWN_TIMEOUT_MS
} from '@main/core/lifecycle'
import type { JobScheduleSnapshot, RetryPolicy, Trigger, UpdateJobScheduleDto } from '@shared/data/api/schemas/jobs'
import { type JobError, type JobSnapshot } from '@shared/data/api/schemas/jobs'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'

import type { JobPayloadOf, JobType } from './jobRegistry'
import { computeBackoff } from './runtime/backoff'
import { computeCatchUpAction } from './runtime/catchUp'
import { DispatchQueue } from './runtime/DispatchQueue'
import { runStartupRecovery } from './runtime/recovery'
import {
  type EnqueueOptions,
  JOB_PROGRESS_KEY_PREFIX,
  JOB_STATE_KEY_PREFIX,
  type JobCancelResult,
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
 * Wall-clock "quiet window" between `onAllReady` firing and JobManager actually
 * running its startup recovery. Lets cold-start IO (DB warm-up, window paints,
 * client-side bootstrap) settle before scheduled work piles on. Hardcoded — the
 * test fixture skips this wait via fake timers, then awaits `_recoveryDone`.
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

/** Maximum `.cause` chain depth joined into a failed job's error message. Guards against cyclic causes. */
const MAX_ERROR_CAUSE_DEPTH = 3

/**
 * Join an error with its `.cause` chain into one message — e.g. a bare "fetch failed"
 * becomes "fetch failed: getaddrinfo ENOTFOUND api.example.com" — so the underlying
 * network/provider detail survives into `JobError.message`, the only field of `JobError`
 * that reaches the renderer (`JobErrorSchema` has no `cause` field).
 */
function formatErrorWithCause(err: unknown): string {
  const messages: string[] = []
  let current: unknown = err
  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH && current instanceof Error; depth++) {
    messages.push(current.message || current.name)
    current = current.cause
  }
  return messages.length > 0 ? messages.join(': ') : String(err)
}

interface FinishedResolver {
  resolve: (snapshot: JobSnapshot) => void
  promise: Promise<JobSnapshot>
}

/**
 * Ordered top-level steps of the deferred startup-recovery flow. A pause hold
 * short-circuits the flow only at these boundaries (plus per-schedule
 * boundaries inside 'catch-up'); the cursor below records where to resume.
 */
const RECOVERY_STEPS = ['reset', 'resurrect', 'catch-up', 'arm', 'dispatch'] as const
type RecoveryStep = (typeof RECOVERY_STEPS)[number]

/**
 * Resume cursor for a pause-interrupted startup-recovery flow. Set ONLY by
 * the flow itself: (a) the quiet-window timer firing while paused (full
 * replay from 'reset'), or (b) an already-running flow short-circuiting at a
 * step boundary. The release compensation pass consumes it — see
 * `runReleaseCompensation`.
 */
interface RecoveryResumePoint {
  step: RecoveryStep
  /** Captured listEnabled() snapshot from the interrupted flow; re-listed when absent. */
  schedules?: JobScheduleSnapshot[]
  /**
   * First schedule index inside 'catch-up' whose step has not STARTED. A step
   * (one schedule's onMissed + catch-up enqueue) is atomic — a started step
   * runs to completion, so "un-started index" is all the cursor needs for
   * exactly-once catch-up.
   */
  catchUpIndex?: number
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
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly finishedResolvers = new Map<string, FinishedResolver>()
  /**
   * In-flight execution markers populated by `spawnExecute` regardless of who
   * enqueued the job. The authoritative in-memory set of jobIds this process is
   * currently executing. Consumers:
   *   - `cancel()` waits on the promise for the handler to release.
   *   - startup recovery filters these out (via the `isJobInFlight` predicate)
   *     so a job started during the quiet window is never reset/re-dispatched.
   *   - `spawnExecute` guards against double-running an id already present.
   * Lives independent of `finishedResolvers` because cross-restart dispatch
   * never builds a `handleFor` entry, leaving the resolver map empty even while
   * a controller is registered.
   */
  private readonly inFlightExecuted = new Map<string, Promise<void>>()
  private readonly scheduleDisposables = new Map<string, Disposable>()
  private readonly globalMaxConcurrency = DEFAULT_GLOBAL_MAX_CONCURRENCY
  /**
   * Set when a dispatch is blocked solely by the global concurrency cap. On the
   * next job completion (which frees a global slot) `resolveAndDispatch` fans
   * out to every queue instead of only the finished job's queue, so a queue
   * starved purely by the global cap — with its own per-queue slots free — wakes
   * immediately rather than waiting for the next delayed-promotion tick.
   */
  private globalCapReached = false
  /**
   * Flipped to `true` in `onStop` so the deferred startup recovery — whether still
   * pending inside the startup-delay timer or already mid-flight inside
   * `runStartupRecoveryFlow` — short-circuits before touching a tearing-down
   * container. Checked at the timer callback entry and between every IO step
   * of the recovery flow.
   */
  private _isShuttingDown = false

  /**
   * Promise tracking the deferred startup recovery flow. Assigned in the
   * setTimeout callback once the flow actually starts; `runReleaseCompensation`
   * extends it with the replay + `finishRelease` tail on async releases.
   * `onStop` awaits it to join the whole chain before disposing of in-flight
   * resources. `protected` (not `private`) so test fixtures can `await` it
   * without invoking the real 60 s timer; production code MUST NOT depend on
   * this field.
   */
  protected _recoveryDone: Promise<void> | undefined

  /**
   * Live pause holds (write quiesce, see `pause()`). Refcounted: the manager
   * is paused while ANY token is present; disposing the last one runs the
   * release compensation pass. Tokens are per-call symbols so a double
   * dispose of one hold cannot release someone else's.
   */
  private readonly pauseHolds = new Set<symbol>()
  /**
   * `once` schedule ids whose fire callback was suppressed by the pause gate.
   * scheduleOnce self-cleans its timer before invoking the callback, so a
   * suppressed one-shot has NO timer left — release re-arms exactly these ids
   * (after re-checking the row is still enabled). Never rebuild from a
   * blanket "enabled ∧ missing scheduler entry" scan: historical completed
   * one-shots satisfy that predicate too (markFired does not flip `enabled`).
   */
  private readonly suppressedOnceScheduleIds = new Set<string>()
  /**
   * Schedule ids whose cron was paused at the croner layer for the current
   * pause window. The gate must sit below the callback: croner's
   * `_checkTrigger` decrements `maxRuns` BEFORE invoking the callback, so a
   * callback-body-only gate would burn a `limit` cron's quota on suppressed
   * fires (a `limit: 1` cron would die without ever running). Croner's native
   * pause short-circuits before the decrement. Release resumes each id after
   * re-checking it is still armed (unregister / pauseJobScheduleById dispose
   * the entry mid-window).
   */
  private readonly pausedCronScheduleIds = new Set<string>()
  /**
   * Delayed/retry promotion fires suppressed by the pause gate, keyed by
   * SchedulerService id (`job:*` / `retry:*`). Their once-timers self-clean
   * before the callback, and a fire can precede the row's wall-clock
   * scheduledAt (see `promoteDueAtFire`) — if release also lands before it,
   * `promoteDelayedDue` alone cannot promote the row and no timer remains
   * (stranded until the 5-minute tick). The release pass replays each entry
   * through `promoteDueAtFire`, reusing its re-arm protection.
   */
  private readonly suppressedPromotionFires = new Map<string, { jobId: string; queue: string }>()
  /** Pending recovery-replay cursor — see `RecoveryResumePoint`. */
  private recoveryReplayPoint: RecoveryResumePoint | null = null
  /**
   * Internal release barrier: held from the moment the last pause hold is
   * disposed until the release-triggered recovery settlement (a cursor
   * replay OR a flow still blocked inside an atomic step) has finished.
   * Autonomous entry points gate on `isAutonomySuspended` (holds OR
   * barrier), so dropping the last hold cannot resurrect fires/claims that
   * would race the still-running recovery — e.g. a natural interval fire
   * doubling the flow's stale-snapshot catch-up enqueue. The recovery flow
   * itself checks only the real holds (`isQuiesced`), so the barrier can
   * never short-circuit it. Cleared on the release chain right before the
   * kicks run (see `finishRelease`).
   */
  private releaseBarrierHeld = false
  /**
   * True while the deferred startup-recovery flow (or its replay) is
   * executing — including parked inside an atomic step. Lets the release
   * compensation detect the "blocked in-step, no cursor" case, where it
   * must hold the barrier and chain the kicks WITHOUT starting a second
   * flow (the parked flow resumes on its own).
   */
  private recoveryFlowInFlight = false

  /**
   * True while at least one `pause()` hold is live (write quiesce). Distinct
   * from BaseService's lifecycle `isPaused` (LifecycleState.Paused) — the
   * quiesce never changes the service's lifecycle state.
   */
  private get isQuiesced(): boolean {
    return this.pauseHolds.size > 0
  }

  /**
   * Gate predicate for autonomous activity (dispatch claims, schedule fire
   * callbacks, GC / promotion maintenance, delayed-promotion fires): frozen
   * while a pause hold is live OR the post-release barrier holds.
   * Request-driven surfaces (enqueue, cancel, schedule mutations) never
   * check this.
   */
  private get isAutonomySuspended(): boolean {
    return this.pauseHolds.size > 0 || this.releaseBarrierHeld
  }

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
    // Both ticks are autonomous writes — gated in the callback body while a
    // pause hold is live (`registerInterval` has no per-callback pause hook).
    // Skipped passes need no bookkeeping: the DB rows are the truth source
    // and the release compensation runs promoteDelayedDue + dispatchAll.
    this.registerInterval(() => {
      if (this.isAutonomySuspended) return
      this.runGC()
    }, GC_INTERVAL_MS)
    this.registerInterval(() => {
      if (this.isAutonomySuspended) return
      const promoted = jobService.promoteDelayedDue(Date.now())
      if (promoted > 0) {
        logger.debug('Promoted delayed jobs', { count: promoted })
        this.dispatchAll()
      }
    }, DELAYED_PROMOTION_INTERVAL_MS)
  }

  /**
   * Schedules deferred startup recovery as a service-level business task — NOT
   * a lifecycle initialization side effect.
   *
   * `onAllReady` returns synchronously after registering a `setTimeout`; the
   * 60 s "quiet window" lets cold-start IO (DB warm-up, window paints, client
   * bootstrap) settle before scheduled work resumes. The deferred flow is
   * owned by JobManager itself (joined by `onStop` via `_recoveryDone`), not
   * by the lifecycle framework — `LifecycleManager.allReady()` is
   * fire-and-forget and does NOT await this hook.
   *
   * Handler registry is guaranteed populated by the time the timer fires
   * because every consumer's `onInit` (and `onReady`) has run, regardless of
   * the consumer's phase. The shutdown short-circuit handles the case where a
   * teardown arrives inside the quiet window — see `_isShuttingDown`.
   */
  protected override onAllReady(): void {
    const handle = setTimeout(() => {
      if (this._isShuttingDown) {
        logger.info('Startup recovery skipped: shutdown requested during quiet window')
        return
      }
      if (this.isQuiesced) {
        // Write quiesce is active — defer the entire flow to the release
        // compensation pass. `_recoveryDone` stays unset: nothing is in
        // flight, so drainInFlight correctly reports no pending recovery.
        this.recoveryReplayPoint = { step: 'reset' }
        logger.info('Startup recovery deferred: JobManager is paused')
        return
      }
      this._recoveryDone = this.runStartupRecoveryFlow()
    }, JOB_MANAGER_STARTUP_DELAY_MS)
    this.registerDisposable(() => clearTimeout(handle))
  }

  /**
   * Deferred startup recovery. Each IO step is wrapped in its own try/catch so
   * a single failure (e.g. a malformed trigger) cannot leave the session with
   * zero armed schedules. `_isShuttingDown` is re-checked between every step
   * so a teardown arriving mid-flight short-circuits the remainder.
   *
   * Step order is significant:
   *
   *   1. `runStartupRecovery` resets non-terminal rows per handler strategy
   *      (abandon / retry / singleton) and honours `cancelRequested` overrides,
   *      EXCEPT rows this process is still executing (`inFlightExecuted`), which
   *      are excluded so a job started during the quiet window is not re-dispatched.
   *
   *   2. Resurrect queues for any non-terminal rows from previous runs so
   *      pending dispatch lands on the next tick. `dispatchAll()` iterates
   *      `this.queues`, which is empty on cold start — pending rows reset by
   *      recovery would otherwise wait until the next `enqueue` arrives and
   *      lazily ensures a queue. Walking distinct `(queue, type)` pairs lets
   *      pending rows dispatch immediately; delayed rows piggyback because
   *      the queue is in place ahead of the next `promoteDelayedDue` tick.
   *
   *      Concurrency consistency: `ensureQueue` here uses
   *      `handler.defaultConcurrency ?? 1`, identical to the `enqueue` path
   *      — cold-start resurrection cannot drift from steady-state behaviour.
   *      First-writer-wins: `ensureQueue` ignores concurrency when the queue
   *      already exists, so if multiple types share a queue name, the first
   *      `(queue, type)` pair from the SQL groupBy decides concurrency. No
   *      shipped type does this today, but the semantics live here in case
   *      future code does. `detectAndDispatchOverdue` (step 3) and
   *      `armSchedule` (step 4) both route through `enqueue`, which calls
   *      `ensureQueue` again on the same queue names — those re-ensures are
   *      no-ops thanks to first-writer-wins.
   *
   *   3. Catch-up FIRST, then arm. Two reasons:
   *        a. `detectAndDispatchOverdue` reads `lastRun` / `nextRun` from the
   *           DB and is independent of in-process scheduler state — arming
   *           order cannot change its decisions.
   *        b. If we armed first, a cron schedule with `protect: true` could
   *           still fire its natural calendar concurrently with our catch-up
   *           enqueue (`protect` only blocks overlapping callbacks, not
   *           external callers). Sequencing catch-up before arm guarantees
   *           the make-up enqueue lands before croner's first natural fire.
   *
   *   4. `dispatchAll` kicks per-queue pumps so pending rows reset by step 1
   *      start running immediately rather than waiting on the next enqueue.
   *
   * Pause interplay (write quiesce): a live pause hold short-circuits the
   * flow at every step boundary above — plus between per-schedule catch-up
   * steps — recording a resume cursor for the release compensation pass. A
   * STARTED catch-up step (one schedule's onMissed + catch-up enqueue) is
   * atomic and runs to completion even if pause lands inside its awaited
   * `onMissed`; drainInFlight joins the flow, so that enqueue always lands
   * before a drain verdict. `resume` re-enters from the cursor; completed
   * catch-up steps are never re-run (`computeCatchUpAction` reads
   * lastRun/nextRun, which catch-up enqueues do not update — a re-run would
   * duplicate make-up jobs). Shutdown still wins over pause and leaves no
   * replay debt.
   */
  private runStartupRecoveryFlow(resume?: RecoveryResumePoint): Promise<void> {
    // Wrapper only tracks the in-flight flag (release compensation reads it
    // to detect a flow blocked inside a step — see runReleaseCompensation).
    this.recoveryFlowInFlight = true
    return this.executeStartupRecoveryFlow(resume).finally(() => {
      this.recoveryFlowInFlight = false
    })
  }

  private async executeStartupRecoveryFlow(resume?: RecoveryResumePoint): Promise<void> {
    const startIndex = RECOVERY_STEPS.indexOf(resume?.step ?? 'reset')
    // Boundary check: shutdown wins (teardown is onStop's job, no replay
    // debt); pause records where the release pass must resume.
    const interruptedAt = (point: RecoveryResumePoint): boolean => {
      if (this._isShuttingDown) return true
      if (this.isQuiesced) {
        this.recoveryReplayPoint = point
        logger.info('Startup recovery interrupted by pause — will replay on release', {
          step: point.step,
          catchUpIndex: point.catchUpIndex ?? null
        })
        return true
      }
      return false
    }

    if (startIndex <= RECOVERY_STEPS.indexOf('reset')) {
      if (interruptedAt({ step: 'reset' })) return
      try {
        const stats = runStartupRecovery(this.handlers, (id) => this.inFlightExecuted.has(id))
        logger.info('Startup recovery complete', stats)
      } catch (err) {
        logger.error('Startup recovery failed', err as Error)
      }
    }

    if (startIndex <= RECOVERY_STEPS.indexOf('resurrect')) {
      if (interruptedAt({ step: 'resurrect' })) return
      try {
        const activeQueues = jobService.getDistinctActiveQueues()
        for (const { queue, type } of activeQueues) {
          if (this._isShuttingDown) return
          const handler = this.handlers.get(type)
          if (!handler) {
            // runStartupRecovery should have cancelled orphan rows already, so
            // a missing handler here is a recovery-implementation regression.
            logger.warn('Orphan (queue, type) survived recovery — skipping ensureQueue', { queue, type })
            continue
          }
          this.ensureQueue(queue, handler.defaultConcurrency ?? 1)
        }
        if (activeQueues.length > 0) {
          logger.info('Resurrected queues from non-terminal jobs', { count: activeQueues.length })
        }
      } catch (err) {
        logger.error('Queue resurrection failed', err as Error)
      }
    }

    let schedules: JobScheduleSnapshot[] = resume?.schedules ?? []
    if (startIndex <= RECOVERY_STEPS.indexOf('catch-up')) {
      let cursor = resume?.step === 'catch-up' ? (resume.catchUpIndex ?? 0) : 0
      if (interruptedAt({ step: 'catch-up', schedules: resume?.schedules, catchUpIndex: cursor })) return
      try {
        if (!resume?.schedules) schedules = jobScheduleService.listEnabled()
        // The loop exits early only on shutdown or pause; the boundary check
        // then either returns (recording the exact un-started index) or —
        // if the pause was already lifted — resumes the loop in place.
        for (;;) {
          cursor = await this.detectAndDispatchOverdue(schedules, cursor)
          if (cursor >= schedules.length) break
          if (interruptedAt({ step: 'catch-up', schedules, catchUpIndex: cursor })) return
        }
      } catch (err) {
        logger.error('Overdue detection failed', err as Error)
      }
    }

    if (startIndex <= RECOVERY_STEPS.indexOf('arm')) {
      for (const schedule of schedules) {
        if (interruptedAt({ step: 'arm', schedules })) return
        try {
          this.armSchedule(schedule)
        } catch (err) {
          logger.error('armSchedule failed', err as Error, { scheduleId: schedule.id })
        }
      }
    }

    if (startIndex <= RECOVERY_STEPS.indexOf('dispatch')) {
      if (interruptedAt({ step: 'dispatch' })) return
      try {
        this.dispatchAll()
      } catch (err) {
        logger.error('dispatchAll failed', err as Error)
      }
    }

    logger.info('JobManager startup recovery complete', { schedules: schedules.length })
  }

  protected override async onStop(): Promise<void> {
    this._isShuttingDown = true

    // Join the deferred startup recovery flow if it had already started before
    // shutdown. The flag flip above also short-circuits any mid-flight IO step
    // currently running inside `runStartupRecoveryFlow`, so this `await` only
    // waits for that step to finish — not for the entire flow.
    if (this._recoveryDone) {
      try {
        await this._recoveryDone
      } catch {
        // Errors are already logged inside `runStartupRecoveryFlow`.
      }
    }

    // Wait on the executor signals, NOT `finishedResolvers`: cross-restart
    // dispatched jobs never build a resolver (nothing to wait on), and
    // `finished` resolves BEFORE finalizeJob awaits onSettled, so settlement
    // writes (e.g. the agent.task breaker) would leak past shutdown. The
    // executed signal resolves in spawnExecute's finally — after finalize AND
    // onSettled — and exists for every execution in this process. Same
    // primitive as drainInFlight. Snapshot before aborting: the finally
    // deletes entries as handlers settle.
    const inFlight = Array.from(this.inFlightExecuted.keys())
    const executedSignals = Array.from(this.inFlightExecuted.values())
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
      const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS))
      // Executed signals are resolve-only (never reject), so Promise.all
      // cannot short-circuit on a rejection.
      const winner = await Promise.race([Promise.all(executedSignals).then(() => 'done' as const), timeout])

      if (winner === 'timeout') {
        logger.warn('JobManager.onStop timed out — pending jobs will be recovered on next start', {
          inFlight: inFlight.length,
          timeoutMs: SHUTDOWN_TIMEOUT_MS
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
    this.pauseHolds.clear()
    this.suppressedOnceScheduleIds.clear()
    this.pausedCronScheduleIds.clear()
    this.suppressedPromotionFires.clear()
    this.recoveryReplayPoint = null
    this.releaseBarrierHeld = false
    this.recoveryFlowInFlight = false
  }

  // ---------------- Handler registry ----------------

  /**
   * Register a handler for a JobRegistry type. Must be called from the owning
   * service's `onInit` so the handler is in place before JobManager's startup
   * recovery runs (~60 s after `onAllReady` fires, owned by `runStartupRecoveryFlow`).
   * Registering from a business service's `onAllReady` is unsafe — that hook
   * fires in parallel with JobManager's `onAllReady`, and by the time the
   * deferred recovery wakes up, existing non-terminal jobs for an unregistered
   * type get treated as orphans and cancelled.
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

  // ---------------- Pause / drain (write quiesce) ----------------

  /**
   * Pause the manager: no new fires / claims / maintenance writes while any
   * hold is live. In-flight executions keep running until drained. Likewise
   * no NEW startup-recovery steps start, but a started step (one schedule's
   * onMissed + catch-up enqueue, atomic) runs to completion and is awaited
   * by drainInFlight. There is deliberately NO manager-level resume():
   * release your own hold; when the last hold is disposed the manager runs
   * its catch-up pass. A lost hold fails closed (paused until relaunch).
   *
   * Request-driven writes stay allowed: enqueue/enqueueTx land rows at rest
   * (the snapshot captures them), cancel and schedule mutations serve
   * in-flight settlement and user actions, and triggerJobScheduleNow* is
   * forced onto its direct-enqueue fallback. No API throws because of a
   * pause — there is no pause-related error code.
   *
   * @param reason - Logged with the hold for "why is nothing running" debugging
   * @returns Hold token; disposing it is idempotent and releases only this hold
   */
  pause(reason?: string): Disposable {
    const token = Symbol(reason ?? 'jobmanager-pause')
    this.pauseHolds.add(token)
    if (this.pauseHolds.size === 1) this.engageCronPause()
    logger.info('JobManager paused', { reason: reason ?? null, holds: this.pauseHolds.size })
    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token)) return
        logger.info('JobManager pause hold released', { reason: reason ?? null, holds: this.pauseHolds.size })
        if (this.pauseHolds.size > 0) return
        // Shutdown wins: onStop owns the teardown, compensation would only
        // race it (and its dispatches would be aborted immediately anyway).
        if (this._isShuttingDown) return
        this.runReleaseCompensation()
      }
    }
  }

  /**
   * Await in-flight handler executions (incl. onSettled) AND the in-flight
   * deferred startup-recovery flow, bounded by timeoutMs. Never rejects.
   * Clean = stragglerIds empty AND !startupRecoveryPending.
   *
   * PRECONDITION: the caller must hold a live pause() hold — without one the
   * in-flight set can grow again after this returns, so a clean verdict is a
   * point-in-time snapshot and MUST NOT gate a DB snapshot. Called with no
   * active hold: logs a warn, does not throw.
   *
   * Stragglers are NOT aborted on timeout: an abort would settle them as
   * `cancelled` into the DB snapshot and they would never re-run after a
   * restore; left running, the snapshot sees `running` and startup recovery
   * applies the handler's strategy. `startupRecoveryPending: true` means the
   * recovery flow is still blocked inside a step (an unbounded
   * `handler.onMissed` — its catch-up enqueue has not landed yet); a flow
   * that short-circuited at a step boundary resolves and writes nothing
   * more, so it reports `false` (the remainder is release's debt, not a
   * pending write).
   *
   * @param opts.timeoutMs - Upper bound on the wait; on expiry the verdict
   *   carries whatever is still unsettled
   */
  async drainInFlight(opts: {
    timeoutMs: number
  }): Promise<{ stragglerIds: string[]; startupRecoveryPending: boolean }> {
    if (!this.isQuiesced) {
      logger.warn('drainInFlight called without an active pause hold — the verdict is a point-in-time snapshot')
    }

    // Wait on the executor signals (resolve in spawnExecute's finally, AFTER
    // finalize + onSettled), never on JobHandle.finished: finalizeJob
    // resolves `finished` before awaiting onSettled, so settlement writes
    // (e.g. the agent.task breaker) would leak past the verdict. The set can
    // only shrink while paused (claims are gated), so the snapshot is the
    // complete wait set.
    const waitedIds = Array.from(this.inFlightExecuted.keys())
    const waited = waitedIds.map((id) => this.inFlightExecuted.get(id)!)

    const recovery = this._recoveryDone
    let recoverySettled = recovery === undefined
    const parts: Promise<unknown>[] = [...waited]
    if (recovery) {
      // Join the recovery flow inside the SAME bounded race: outside it the
      // timeout contract breaks; inside it without its own verdict field a
      // timeout would return an empty straggler list — a false clean.
      parts.push(
        recovery.then(() => {
          recoverySettled = true
        })
      )
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), opts.timeoutMs)
    })
    const winner = await Promise.race([Promise.all(parts).then(() => 'done' as const), timeout])
    if (timeoutHandle) clearTimeout(timeoutHandle)

    if (winner === 'done') {
      return { stragglerIds: [], startupRecoveryPending: false }
    }
    const stragglerIds = waitedIds.filter((id) => this.inFlightExecuted.has(id))
    logger.warn('drainInFlight timed out with unsettled work', {
      timeoutMs: opts.timeoutMs,
      stragglerIds,
      startupRecoveryPending: !recoverySettled
    })
    return { stragglerIds, startupRecoveryPending: !recoverySettled }
  }

  /**
   * First-hold bookkeeping: pause every armed cron at the croner layer.
   * Filtered to `trigger.kind === 'cron'` — SchedulerService.pause is a warn
   * no-op for interval/once (their fires are gated in the callback body
   * instead), and calling it anyway would spam the log per pause.
   */
  private engageCronPause(): void {
    const scheduler = application.get('SchedulerService')
    for (const id of this.scheduleDisposables.keys()) {
      const snapshot = jobScheduleService.getById(id)
      if (snapshot?.trigger.kind !== 'cron') continue
      scheduler.pause(`schedule:${id}`)
      this.pausedCronScheduleIds.add(id)
    }
  }

  /**
   * Compensation pass run when the last hold is disposed. Recovery debt
   * settles FIRST: the deferred flow reconciles rows from the previous run
   * (abandon / singleton / orphan) and its catch-up must precede cron
   * re-arming. Kicking dispatch or resuming fires before it would let a
   * dispatch claim a not-yet-reconciled row — a claimed row is excluded from
   * the reset sweep as in-flight, so the strategy bypass is irreversible
   * (e.g. a singleton could end up running twice) — and would let natural
   * cron fires race their own make-up enqueues. So with debt pending, ALL
   * kicks chain after the replay; without debt they run inline.
   *
   * Deferring the explicit kicks alone is not enough for the second race:
   * the moment the last hold is gone, interval chains, croner timers and
   * job-completion dispatches resume on their own. Both async branches
   * therefore hold `releaseBarrierHeld` (set synchronously here — no timer
   * callback can interleave before it is up), which keeps every
   * `isAutonomySuspended` gate closed until `finishRelease` drops it after
   * the recovery settles.
   *
   * Replay stays single-flight: chained onto `_recoveryDone` so a second
   * flow can never overlap the first and onStop joins the whole chain. The
   * cursor is set only by the flow itself; when it is absent but a flow is
   * still in flight, that flow is blocked inside an atomic step and resumes
   * on its own (see runStartupRecoveryFlow) — only the barrier + kicks are
   * chained behind it, never a second flow.
   */
  private runReleaseCompensation(): void {
    if (this.recoveryReplayPoint) {
      const resume = this.recoveryReplayPoint
      this.recoveryReplayPoint = null
      this.releaseBarrierHeld = true
      const prior = this._recoveryDone ?? Promise.resolve()
      this._recoveryDone = prior.then(() => this.runStartupRecoveryFlow(resume)).then(() => this.finishRelease())
    } else if (this.recoveryFlowInFlight) {
      this.releaseBarrierHeld = true
      const prior = this._recoveryDone ?? Promise.resolve()
      this._recoveryDone = prior.then(() => this.finishRelease())
    } else {
      this.runPostReleaseKicks()
    }
  }

  /**
   * Tail of the async release paths: drop the barrier, then run the kicks in
   * the same synchronous section — no timer callback can fire in between, so
   * entries recorded in the suppressed sets during the barrier window cannot
   * be missed. A new pause taken meanwhile is fine: its holds keep the
   * autonomy gates closed on their own, and the kicks' guard skips without
   * draining the sets (that pause's release inherits the debt and re-arms
   * the barrier if recovery is again outstanding).
   */
  private finishRelease(): void {
    this.releaseBarrierHeld = false
    this.runPostReleaseKicks()
  }

  /**
   * Dispatch/fire re-enablement half of the release compensation (see
   * `runReleaseCompensation` for why it may run AFTER an async recovery
   * replay). Re-checks the gates at execution time: under shutdown, a newer
   * pause, or a still-held release barrier (a hold released in the microtask
   * window before `finishRelease` drops it) it skips WITHOUT draining the
   * suppressed sets, so the barrier's own `finishRelease` (or that pause's
   * release) inherits the debt.
   */
  private runPostReleaseKicks(): void {
    if (this._isShuttingDown || this.isQuiesced || this.releaseBarrierHeld) return

    // 1. Wake delayed/retry promotions whose once-timers fired suppressed
    //    during the window — the DB rows are the truth source. Fires that
    //    preceded their row's wall-clock scheduledAt are replayed through
    //    promoteDueAtFire so its re-arm protection covers rows not yet due.
    try {
      const promoted = jobService.promoteDelayedDue(Date.now())
      if (promoted > 0) {
        logger.info('Pause release: promoted delayed jobs', { count: promoted })
      }
    } catch (err) {
      logger.error('Pause release: promoteDelayedDue failed', err as Error)
    }
    for (const [scheduleId, { jobId, queue }] of this.suppressedPromotionFires) {
      try {
        this.promoteDueAtFire(scheduleId, jobId, queue)
      } catch (err) {
        logger.error('Pause release: suppressed promotion replay failed', err as Error, { jobId })
      }
    }
    this.suppressedPromotionFires.clear()
    this.dispatchAll()

    // 2. Re-arm the one-shots whose single fire was suppressed — ONLY from
    //    the recorded set. A blanket "enabled ∧ missing scheduler entry"
    //    rebuild would replay historical completed one-shots (markFired does
    //    not flip `enabled`; fired state lives in lastRun only).
    for (const id of this.suppressedOnceScheduleIds) {
      try {
        const snapshot = jobScheduleService.getById(id)
        if (snapshot?.enabled) this.armSchedule(snapshot)
      } catch (err) {
        logger.error('Pause release: suppressed once re-arm failed', err as Error, { scheduleId: id })
      }
    }
    this.suppressedOnceScheduleIds.clear()

    // 3. Resume croner-level pauses, skipping ids whose entry was removed
    //    during the window (unregister / pauseJobScheduleById / disable all
    //    dispose the scheduler entry — resuming those would be wrong).
    //    Missed fires stay skipped: croner does not catch up.
    const scheduler = application.get('SchedulerService')
    for (const id of this.pausedCronScheduleIds) {
      if (this.scheduleDisposables.has(id)) scheduler.resume(`schedule:${id}`)
    }
    this.pausedCronScheduleIds.clear()
  }

  // ---------------- enqueue / cancel / list / get ----------------

  /**
   * Validation + row construction shared by `enqueue` and `enqueueTx`. Pure —
   * no queue registration, no DB access, no side effects. `ensureQueue` stays
   * at the call sites AFTER their idempotency check, so an idempotency hit
   * does not register a stray in-memory queue entry.
   */
  private prepareEnqueue<K extends JobType>(
    type: K,
    input: JobPayloadOf<K>,
    opts: EnqueueOptions
  ): { handler: JobHandler; queueName: string; insertRow: InsertJobRow } {
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

    // Enforce maxAttempts floor at the enqueue boundary so an in-process
    // miscall cannot create a maxAttempts=0 row that never retries and
    // surprises the operator.
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

    const queueName = opts.queue ?? handler.defaultQueue?.(input as never) ?? type
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

    return { handler, queueName, insertRow }
  }

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
  enqueue<K extends JobType>(type: K, input: JobPayloadOf<K>, opts: EnqueueOptions = {}): JobHandle {
    const { handler, queueName, insertRow } = this.prepareEnqueue(type, input, opts)

    if (opts.idempotencyKey) {
      const existing = jobService.findActiveByIdempotencyKey(opts.idempotencyKey)
      if (existing) {
        logger.info('idempotencyKey match — returning existing handle', {
          type,
          key: opts.idempotencyKey,
          existingId: existing.id
        })
        return this.handleFor(existing)
      }
    }

    this.ensureQueue(queueName, handler.defaultConcurrency ?? 1)

    const snapshot = jobService.create(insertRow)
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
      scheduledAt: insertRow.scheduledAt
    })
    return handle
  }

  /**
   * Transactional variant of `enqueue`: the job INSERT goes through the
   * caller's transaction, so a business-state write and its job enqueue
   * commit (or roll back) atomically.
   *
   * Contract:
   *   - Call inside a `DbService.withWriteTx` callback and pass its `tx`.
   *     (A bare db handle also works but is pointless — use `enqueue`.)
   *   - Post-commit side effects (publishState, dispatch / delayed arming)
   *     are deferred by one microtask. better-sqlite3 transactions are fully
   *     synchronous, so the microtask runs strictly after COMMIT / ROLLBACK.
   *   - If the caller's tx rolls back, the returned handle's `finished` never
   *     resolves — the resolver is discarded, no `failed` snapshot is
   *     synthesized (same policy as onStop). Normally the rollback's throw
   *     propagates through `withWriteTx` to the caller, so the handle never
   *     escapes anyway.
   *   - If `opts.idempotencyKey` collides with the partial unique index at
   *     INSERT time, the typed error aborts the WHOLE caller transaction —
   *     business writes roll back too. That is what atomicity demands, but
   *     callers must expect it.
   */
  enqueueTx<K extends JobType>(tx: DbOrTx, type: K, input: JobPayloadOf<K>, opts: EnqueueOptions = {}): JobHandle {
    const { handler, queueName, insertRow } = this.prepareEnqueue(type, input, opts)

    if (opts.idempotencyKey) {
      const existing = jobService.findActiveByIdempotencyKeyTx(tx, opts.idempotencyKey)
      if (existing) {
        logger.info('idempotencyKey match — returning existing handle (tx)', {
          type,
          key: opts.idempotencyKey,
          existingId: existing.id
        })
        // The existing row's dispatch already happened — no microtask needed.
        return this.handleFor(existing)
      }
    }

    this.ensureQueue(queueName, handler.defaultConcurrency ?? 1)

    const snapshot = jobService.createTx(tx, insertRow)
    const handle = this.handleFor(snapshot)

    // Post-commit side effects, deferred one microtask past the synchronous
    // transaction. Re-read the row instead of trusting the insert-time
    // snapshot: a rollback leaves no row (clean up and stop), and the caller's
    // synchronous code may have already moved the job on (publish the truth,
    // and never dispatch a row that is no longer pending). A crash between
    // COMMIT and this microtask leaves a pending row for startup recovery.
    queueMicrotask(() => {
      try {
        const persisted = jobService.getById(snapshot.id)
        if (!persisted) {
          this.finishedResolvers.delete(snapshot.id)
          logger.warn('enqueueTx: row absent after tx — rolled back, resolver discarded', {
            id: snapshot.id,
            type
          })
          return
        }
        this.publishState(persisted)
        logger.info('Job enqueued (tx)', {
          id: persisted.id,
          type,
          queue: persisted.queue,
          status: persisted.status,
          scheduledAt: insertRow.scheduledAt
        })
        if (this._isShuttingDown) return // no new dispatch in the shutdown window; recovery resurrects the row
        if (persisted.status === 'pending') {
          void this.dispatch(persisted.queue)
        } else if (persisted.status === 'delayed') {
          this.armDelayedJob(persisted)
        }
      } catch (err) {
        // A microtask has no caller — an uncaught throw here would surface as
        // a process-level uncaughtException.
        logger.error('enqueueTx: post-commit side effects failed', { id: snapshot.id, type, err })
      }
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
   * @returns The cancel outcome: `'cancelled'` (settled within grace, or a
   *   pending/delayed row finalized directly), `'timed-out'` (force-finalized
   *   after the grace window — the handler may still be running in-memory), or
   *   `'not-cancellable'` (nothing to cancel — already terminal / unknown row).
   *   Callers needing to distinguish a timed-out cancel MUST switch on this
   *   value rather than parsing `error.message`.
   * @throws Error with code `JOB_CANCEL_REASON_TOO_LONG` if `reason` exceeds 500 chars
   */
  async cancel(jobId: string, reason?: string): Promise<JobCancelResult> {
    if (reason !== undefined && reason.length > MAX_CANCEL_REASON_CHARS) {
      throw this.makeError(JOB_ERROR_CODES.CANCEL_REASON_TOO_LONG, 'Cancel reason exceeds 500 characters', {
        length: reason.length
      })
    }

    const dbService = application.get('DbService')
    jobService.setCancelRequestedTx(dbService.getDb(), jobId)

    const controller = this.abortControllers.get(jobId)
    if (controller) {
      controller.abort(new Error(`Job cancelled${reason ? `: ${reason}` : ''}`))
      const snapshot = jobService.getById(jobId)
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
          return { outcome: 'timed-out' }
        }
        // winner === 'done' — handler observed the abort and reached a terminal
        // state within the grace window.
        return { outcome: 'cancelled' }
      }
      // Controller registered but no executor signal: effectively unreachable —
      // `spawnExecute` sets and deletes both maps in lockstep with no await
      // between. The abort was still requested, so report a clean cancel.
      return { outcome: 'cancelled' }
    }

    // Not in-flight — pending / delayed → finalize directly as cancelled.
    // (Once the pending/cancelRequested filter is in claimNextPendingTx,
    // dispatch cannot promote a cancelRequested row to running between the
    // tx above and this branch, so the snapshot here is guaranteed terminal-
    // or-cancellable.)
    const snapshot = jobService.getById(jobId)
    if (snapshot && (snapshot.status === 'pending' || snapshot.status === 'delayed')) {
      await this.finalizeJob(jobId, 'cancelled', undefined, {
        code: JOB_ERROR_CODES.CANCELLED,
        message: reason ?? 'Cancelled by user',
        retryable: false
      })
      return { outcome: 'cancelled' }
    }
    // already-terminal / unknown row → nothing cancelled.
    return { outcome: 'not-cancellable' }
  }

  /**
   * Fire-and-forget batch cancel for all non-terminal jobs matching the filter.
   * Pending / delayed rows are transitioned directly to `cancelled`; running
   * jobs only get their in-process `AbortController` aborted and settle
   * asynchronously through the normal handler-execute flow (handler observes
   * `signal.aborted`) — they are NOT counted as `transitioned`, only as
   * `aborted`.
   *
   * Does NOT wait for running handlers to actually stop. If you must confirm a
   * running job has stopped before destructive cleanup (e.g. deleting a vector
   * store), loop `cancel(id)` per job instead — `cancel` awaits each handler's
   * settlement and force-finalizes on timeout. `cancelMany` is for
   * shutdown-style mass abort where stragglers are acceptable and recovered on
   * next startup.
   *
   * @param filter - Must specify at least `queue` or `type` (empty filter rejected)
   * @param reason - Optional human-readable reason
   * @returns `aborted`: in-flight controllers aborted; `transitioned`: pending / delayed rows finalized synchronously
   * @throws Error if both `filter.queue` and `filter.type` are undefined
   * @throws Error with code `JOB_CANCEL_REASON_TOO_LONG` if `reason` exceeds 500 chars
   */
  cancelMany(filter: { queue?: string; type?: string }, reason?: string): { aborted: number; transitioned: number } {
    if (!filter.queue && !filter.type) {
      throw new Error('cancelMany: filter must specify queue or type (empty filter rejected)')
    }
    if (reason !== undefined && reason.length > MAX_CANCEL_REASON_CHARS) {
      throw this.makeError(JOB_ERROR_CODES.CANCEL_REASON_TOO_LONG, 'Cancel reason exceeds 500 characters', {
        length: reason.length
      })
    }
    const dbService = application.get('DbService')
    const result = dbService.withWriteTx((tx) =>
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
  registerJobSchedule<K extends JobType>(input: JobScheduleRegistrationInput<K>): { id: string } {
    if (!this.handlers.has(input.type)) {
      throw this.makeError(JOB_ERROR_CODES.UNKNOWN_TYPE, `No handler for schedule type "${input.type}"`, {
        type: input.type
      })
    }
    const snapshot = jobScheduleService.create({
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
  resumeJobScheduleById(id: string): boolean {
    const updated = jobScheduleService.setEnabled(id, true)
    if (updated) {
      const snapshot = jobScheduleService.getById(id)
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
   * Exception to the "natural fire calendar" clause: manually firing an
   * overdue never-fired `once` schedule writes `lastRun >= trigger.at`, which
   * the spent-once guard in `armSchedule` treats as the one-shot's fire —
   * startup recovery will not re-arm it for a make-up run.
   *
   * @param id - Schedule row id
   * @returns `true` if fired; `false` if no schedule exists for `id`
   */
  async triggerJobScheduleNowById(id: string): Promise<boolean> {
    const schedule = jobScheduleService.getById(id)
    if (!schedule) return false
    // While paused, force the fallback: croner's .trigger() bypasses its own
    // pause AND the armed callback's gate suppresses the enqueue — the cron
    // path would return true having persisted nothing, silently dropping an
    // explicit request (pause-window callers include an AI turn settling
    // through cherryAutonomyTools). The fallback row lands `pending` at rest
    // and dispatches on release; `true` keeps meaning "row persisted".
    const triggered = this.isAutonomySuspended
      ? false
      : await application.get('SchedulerService').triggerNow(`schedule:${id}`)
    if (triggered) return true
    // Fallback path (non-cron OR cron not currently armed in this process).
    this.enqueue(schedule.type as JobType, schedule.jobInputTemplate as never, {
      scheduleId: schedule.id
    })
    try {
      jobScheduleService.markFired(schedule.id, Date.now(), null)
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
    const id = this.resolveScheduleIdByName(type, name)
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
    const id = this.resolveScheduleIdByName(type, name)
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
    const id = this.resolveScheduleIdByName(type, name)
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
    const id = this.resolveScheduleIdByName(type, name)
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
  updateJobSchedule(id: string, patch: UpdateJobScheduleDto): JobScheduleSnapshot | null {
    const updated = jobScheduleService.update(id, patch)
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
  getJobSchedule<K extends JobType>(type: K, name?: string | null): JobScheduleSnapshot | null {
    let id: string
    try {
      id = this.resolveScheduleIdByName(type, name)
    } catch (err) {
      // For "name required" errors, surface them. For "not found", return null.
      if (err instanceof Error && err.message.includes(JOB_ERROR_CODES.SCHEDULE_NOT_FOUND_BY_NAME)) return null
      throw err
    }
    return jobScheduleService.getById(id)
  }

  private resolveScheduleIdByName(type: string, name?: string | null): string {
    // Map nullish name to the singleton sentinel `''` so the underlying lookup
    // can rely on a uniform string key (DB column is NOT NULL DEFAULT '').
    const nameKey = name ?? ''
    if (name == null) {
      const candidates = jobScheduleService.listAll({ type })
      if (candidates.length > 1) {
        throw this.makeError(
          JOB_ERROR_CODES.SCHEDULE_NAME_REQUIRED,
          `Type "${type}" has multiple schedules — name required`,
          { type, knownNames: candidates.map((c) => c.name) }
        )
      }
      if (candidates.length === 1) return candidates[0].id
    }
    const snapshot = jobScheduleService.getByTypeAndName(type, nameKey)
    if (!snapshot) {
      const knownNames = jobScheduleService.listNamesForType(type)
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
    // Autonomy gate (pause hold or post-release barrier): claiming is the
    // only path that starts an execution.
    if (this.isAutonomySuspended) return
    const queue = this.queues.get(queueName)
    if (!queue) return

    // Layer 1 first (per-queue) serializes ticks against the same queue and
    // avoids wasted write contention. Layer 0 (SQLite's single-writer lock,
    // taken by DbService.withWriteTx via BEGIN IMMEDIATE) serializes all writes
    // across the app. Lock acquisition order is fixed: Layer 1 outside, Layer 0
    // inside (via withWriteTx).
    const releaseQueue = await queue.mutex.acquire()
    let claimed: JobRow | null = null

    try {
      // Re-check after the mutex: a dispatch that passed the entry check and
      // then blocked here is not in `inFlightExecuted`, so drainInFlight can
      // return before it wakes — an entry-only gate would let it claim AFTER
      // the drain verdict. No await sits between this check and the claim tx,
      // so nothing can interleave on the single thread.
      if (this.isAutonomySuspended) return
      const dbService = application.get('DbService')
      claimed = dbService.withWriteTx((tx) => {
        const queueRunning = jobService.countRunningByQueueTx(tx, queueName)
        if (queueRunning >= queue.concurrency) return null
        const globalRunning = jobService.countRunningGlobalTx(tx)
        if (globalRunning >= this.globalMaxConcurrency) {
          this.globalCapReached = true
          return null
        }
        return jobService.claimNextPendingTx(tx, queueName)
      })
    } catch (err) {
      logger.error('dispatch transaction failed', { queue: queueName, error: err })
    } finally {
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

    // Idempotency guard (invariant, defense-in-depth): never run a handler for a
    // jobId this process is already executing. With in-flight-aware startup
    // recovery in place this is unreachable, but it protects against ANY future
    // re-dispatch path double-running a job. Logged at `warn`, NOT `error`:
    // firing it does not fail the job — the original in-flight execution still
    // finalizes the row exactly once — it only flags that some new code path
    // attempted a double-dispatch and was harmlessly short-circuited (an
    // unexpected-but-handled condition, unlike the missing-handler branch above
    // which actually finalizes the job as failed). Placed after the
    // handler-missing finalize (a missing-handler row must still be finalized)
    // and before allocating a second controller/timeout/promise for a row we
    // are about to skip.
    if (this.inFlightExecuted.has(row.id)) {
      logger.warn('spawnExecute: job already in-flight in this process — skipping duplicate dispatch', {
        id: row.id,
        type: row.type
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
      parentId: row.parentId,
      signal: controller.signal,
      metadata: initialMetadata,
      patchMetadata: async (patch) => {
        // Read latest from row.metadata so sequential patches accumulate.
        // The DB write happens FIRST — if it throws, row.metadata stays in
        // sync with the durable state and the handler observes the failure.
        const merged = { ...row.metadata, ...patch }
        const dbService = application.get('DbService')
        jobService.setMetadataTx(dbService.getDb(), row.id, merged)
        row.metadata = merged
      },
      reportProgress: (progress, detail) => {
        application.get('CacheService').setShared(`${JOB_PROGRESS_KEY_PREFIX}${row.id}`, { progress, detail }, 60_000)
      },
      logger: loggerService.withContext('JobExec', { jobId: row.id, type: row.type })
    }

    const task = (async () => {
      // Keep the machine awake for this attempt — best-effort, gated by the user's
      // `app.power.prevent_sleep_when_busy` preference. preventSleep never throws and always
      // returns a Disposable (the provider degrades internally), so no guard is needed here.
      // Declared in the IIFE scope so the finally can dispose it. Per-attempt: between retries
      // the job sits in `delayed` (not working) and must not hold the machine awake.
      const sleepHold = application.get('PowerService').preventSleep(`job:${row.type}:${row.id}`)
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
                message: formatErrorWithCause(err),
                retryable: true
              }

        // Skip user-initiated cancellations — expected and already benign. Genuine
        // failures (including timeouts) are logged with the full `.cause` chain +
        // stack so a diagnostic detail lost by `JobError.message`'s field limits
        // (see `formatErrorWithCause`) is still recoverable from the log file.
        if (error.code !== JOB_ERROR_CODES.CANCELLED) {
          logger.error(`Job failed: ${row.type}`, err as Error, { jobId: row.id, code: error.code })
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
        sleepHold.dispose()
        this.abortControllers.delete(row.id)
        this.inFlightExecuted.delete(row.id)
        resolveExecuted()
      }
    })()

    // Outer safety net: the inner try/catch already handles handler errors and
    // retry/finalize paths, but a leak can still happen if scheduleRetry's
    // fallback finalizeJob throws or any other unexpected exception escapes.
    // We wrap the recovery in its own try/catch so logger errors cannot become
    // a new unhandled rejection, and chain a terminal `.catch(() => {})` to
    // swallow anything that still slips through — this is the hard guarantee
    // that no path produces UnhandledPromiseRejection.
    void task
      .catch(async (outerErr) => {
        try {
          logger.error('spawnExecute leaked exception — forcing terminal state', {
            jobId: row.id,
            err: outerErr
          })
          try {
            await this.finalizeJob(row.id, 'failed', undefined, {
              code: JOB_ERROR_CODES.HANDLER_THREW,
              message: `Internal leaked: ${(outerErr as Error)?.message ?? String(outerErr)}`,
              retryable: false
            })
          } catch (settleErr) {
            logger.error('spawnExecute fallback finalize also failed', {
              jobId: row.id,
              err: settleErr
            })
            // Stranded `running` row will be reclaimed by startup recovery on
            // the next process start.
          }
        } catch {
          // logger itself threw — last-resort silent swallow.
        }
      })
      .catch(() => {
        // Belt-and-suspenders terminal swallow. Should never be reachable, but
        // guarantees `task` cannot produce an unhandled rejection.
      })
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
    const dbService = application.get('DbService')
    let txFailed: Error | undefined
    try {
      jobService.setTerminalTx(dbService.getDb(), jobId, status, output, error)
    } catch (err) {
      txFailed = err as Error
      logger.error('finalizeJob: tx failed — synthesizing failed snapshot to release slot', { jobId, status, err })
    }

    const persisted = jobService.getById(jobId)
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
          parentId: snapshot.parentId,
          status: snapshot.status as 'completed' | 'failed' | 'cancelled',
          input: snapshot.input,
          output: snapshot.output,
          error: snapshot.error,
          attempt: snapshot.attempt,
          metadata: snapshot.metadata
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
    // A completed job frees a global slot. If a dispatch was previously blocked
    // solely by the global cap, re-kick every queue so a queue starved by the
    // cap (with its own slots free) wakes now instead of waiting for the next
    // promotion tick. The flag self-corrects: if the cap is still binding, the
    // follow-up dispatches re-set it. Otherwise just refill this job's queue.
    if (this.globalCapReached) {
      this.globalCapReached = false
      this.dispatchAll()
    } else {
      void this.dispatch(snapshot.queue)
    }
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
    const dbService = application.get('DbService')
    try {
      jobService.setDelayedRetryTx(dbService.getDb(), jobId, nextAttempt, scheduledAt, error)
    } catch (retryWriteErr) {
      // The single-statement write commits on the one better-sqlite3
      // connection; this fallback defends against persistent failures
      // (SQLITE_CORRUPT / FULL / CONSTRAINT, driver bugs, etc.)
      // that would otherwise leave the row stuck in `running` until
      // restart. Degrading to a terminal `failed` with retryable=true
      // surfaces the failure to UI/monitoring while finalizeJob's
      // synthesizeFailedSnapshot guarantees the in-memory slot frees up.
      logger.error('scheduleRetry: persist failed — degrading to finalizeJob(failed)', {
        jobId,
        nextAttempt,
        err: retryWriteErr
      })
      await this.finalizeJob(jobId, 'failed', undefined, {
        code: JOB_ERROR_CODES.HANDLER_THREW,
        message: `Retry persist failed: ${(retryWriteErr as Error).message}; original: ${error.message}`,
        retryable: true
      })
      return
    }

    const scheduler = application.get('SchedulerService')
    const retryId = `retry:${jobId}:${nextAttempt}`
    scheduler.registerSchedule(retryId, { kind: 'once', at: scheduledAt }, () => {
      this.promoteDueAtFire(retryId, jobId, queue)
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
   *
   * A spent `once` schedule (its natural fire already happened) is never
   * re-armed — see the guard below.
   */
  private armSchedule(schedule: JobScheduleSnapshot): void {
    if (!schedule.enabled) return
    // Dispose any prior registration BEFORE the spent-once guard below: an
    // update that turns an armed one-shot spent (e.g. rescheduling it onto a
    // moment already covered by a manual fire) must cancel the pending timer,
    // or it would later fire with its stale closure snapshot.
    if (this.scheduleDisposables.has(schedule.id)) {
      this.scheduleDisposables.get(schedule.id)?.dispose()
      this.scheduleDisposables.delete(schedule.id)
    }
    // A once trigger whose natural fire already happened is spent — re-arming
    // it (startup recovery, re-enable, no-op update) would replay the job on
    // every restart, since scheduleOnce fires a past `at` immediately. Compare
    // against trigger.at rather than mere lastRun presence: a manual trigger
    // also writes lastRun but must not swallow a still-pending natural fire.
    if (
      schedule.trigger.kind === 'once' &&
      schedule.lastRun !== null &&
      Date.parse(schedule.lastRun) >= schedule.trigger.at
    ) {
      logger.debug('Skipping spent once schedule', { scheduleId: schedule.id })
      return
    }

    const scheduler = application.get('SchedulerService')
    const scheduleKey = `schedule:${schedule.id}`
    const trigger: Trigger = schedule.trigger
    const disp = scheduler.registerSchedule(scheduleKey, trigger, async () => {
      // Autonomy gate (pause hold or post-release barrier) — placed BEFORE
      // the try/finally so the suppressed fire writes neither the enqueue nor
      // markFired. Interval chains re-arm in the scheduler wrapper (gating
      // the fire layer would break the chain); a suppressed once has no
      // timer left, so its id is recorded FIRST (Set.add cannot throw) for
      // the release rebuild. Crons are paused at the croner layer (quota
      // safety) — this branch is their defense-in-depth backstop.
      if (this.isAutonomySuspended) {
        if (trigger.kind === 'once') this.suppressedOnceScheduleIds.add(schedule.id)
        return
      }
      const firedAt = Date.now()
      try {
        this.enqueue(schedule.type as JobType, schedule.jobInputTemplate as never, {
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
          // Persist a once fire at no earlier than its `at`: the once timer
          // elapses on the monotonic clock while `firedAt` reads the wall
          // clock, so a natural fire can observe firedAt === at - 1 (see
          // promoteDueAtFire). Unclamped, the spent-once guard above would
          // see lastRun < at and replay the one-shot on the next startup.
          const persistedFiredAt = trigger.kind === 'once' ? Math.max(firedAt, trigger.at) : firedAt
          jobScheduleService.markFired(schedule.id, persistedFiredAt, nextRun?.getTime() ?? null)
        } catch (markErr) {
          logger.warn('markFired failed — nextRun may be stale', {
            scheduleId: schedule.id,
            err: (markErr as Error).message
          })
        }
      }
    })
    this.scheduleDisposables.set(schedule.id, disp)
    // Crons registered (or re-armed) while autonomy is suspended (pause hold
    // or post-release barrier) are paused at the croner layer in the same
    // synchronous section — a timer callback cannot interleave, so there is
    // no fire window. Non-cron re-arms drop any stale paused-cron marker
    // (e.g. a trigger updated cron → interval mid-window).
    if (this.isAutonomySuspended && trigger.kind === 'cron') {
      scheduler.pause(scheduleKey)
      this.pausedCronScheduleIds.add(schedule.id)
    } else {
      this.pausedCronScheduleIds.delete(schedule.id)
    }
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
    scheduler.registerSchedule(jobKey, { kind: 'once', at: scheduledMs }, () => {
      this.promoteDueAtFire(jobKey, snapshot.id, snapshot.queue)
    })
  }

  /**
   * Fire-time body of the delayed-promotion `once` schedules (armDelayedJob /
   * scheduleRetry): promote due rows, then dispatch — or re-arm if the fire
   * landed before the wall clock reached the job's scheduledAt.
   *
   * The re-arm exists because of a clock-domain mismatch: the once-timer
   * elapses on the monotonic (libuv) clock while `promoteDelayedDue` compares
   * `scheduledAt <= Date.now()` on the wall clock. Both round to whole ms
   * independently, so a fire can observe `Date.now() === scheduledAt - 1`
   * (~0.4% of fires, measured). `scheduleOnce` self-cleans before invoking its
   * callback, so a missed promotion would otherwise strand the job in
   * `delayed` until the DELAYED_PROMOTION_INTERVAL_MS tick — up to 5 minutes
   * late in production, a permanent hang in tests (which never arm that tick).
   *
   * Cautions for future edits:
   *   - Do NOT close the gap by inflating the promotion cursor (e.g.
   *     `promoteDelayedDue(Math.max(Date.now(), scheduledMs))`): a row
   *     promoted before the wall clock reaches its scheduledAt is invisible
   *     to the dispatch claim query (also `scheduledAt <= Date.now()`) and
   *     would strand as `pending` instead — same hang, one state later.
   *   - Re-arm at the row's CURRENT scheduledAt, not the original fire time:
   *     the next delay is the exact wall-clock remainder, so the loop
   *     converges (strictly smaller remainder each round) and cannot spin.
   *   - Re-registering the same schedule id is safe by design:
   *     `registerSchedule` replaces an existing id, and `scheduleOnce`
   *     removed this id from its map before invoking the callback.
   */
  private promoteDueAtFire(scheduleId: string, jobId: string, queue: string): void {
    // Autonomy gate (pause hold or post-release barrier): skip the promotion
    // write, but record the fire FIRST — scheduleOnce already self-cleaned
    // this timer, and this fire may precede the row's wall-clock scheduledAt
    // (the same clock-domain mismatch the re-arm below exists for). If
    // release also lands before scheduledAt, promoteDelayedDue alone cannot
    // promote the row and nothing would re-arm it until the 5-minute
    // promotion tick — so the release pass replays each recorded fire
    // through this method instead.
    if (this.isAutonomySuspended) {
      this.suppressedPromotionFires.set(scheduleId, { jobId, queue })
      return
    }
    jobService.promoteDelayedDue(Date.now())
    const row = jobService.getById(jobId)
    if (row?.status === 'delayed' && !this._isShuttingDown) {
      logger.debug('once-fire preceded wall-clock scheduledAt — re-arming', { jobId, scheduleId })
      const scheduler = application.get('SchedulerService')
      scheduler.registerSchedule(scheduleId, { kind: 'once', at: Date.parse(row.scheduledAt) }, () => {
        this.promoteDueAtFire(scheduleId, jobId, queue)
      })
      return
    }
    void this.dispatch(queue)
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
   *
   * One schedule's `onMissed` + catch-up enqueue is an atomic step: shutdown
   * and pause are checked only at the loop top, so a step that entered its
   * (possibly unbounded) `await onMissed` still finishes its enqueue. Returns
   * the first index whose step did NOT start — `schedules.length` when the
   * sweep completed — so a pause-interrupted flow can resume exactly there.
   */
  private async detectAndDispatchOverdue(schedules: JobScheduleSnapshot[], startIndex = 0): Promise<number> {
    const nowMs = Date.now()
    for (let i = startIndex; i < schedules.length; i++) {
      const schedule = schedules[i]
      // Mirror `runStartupRecoveryFlow`'s per-step shutdown check so a teardown
      // arriving mid-loop short-circuits the remainder; without this an
      // `onStop` invocation has to wait for every schedule's `onMissed` +
      // `enqueue` round-trip to finish before `_recoveryDone` resolves.
      // Pause short-circuits at the same boundary (the caller records `i`).
      if (this._isShuttingDown || this.isQuiesced) return i
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
        this.enqueue(schedule.type as JobType, schedule.jobInputTemplate as never, {
          scheduleId: schedule.id,
          scheduledAt
        })
        logger.info('Catch-up enqueued', { scheduleId: schedule.id, type: schedule.type, scheduledAt })
      }
    }
    return schedules.length
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
  private runGC(): void {
    const cutoff = Date.now() - GC_TERMINAL_TTL_MS
    let byTtl = 0
    let byCount = 0
    try {
      byTtl = jobService.pruneTerminalOlderThan(cutoff)
    } catch (err) {
      logger.error('GC: pruneTerminalOlderThan failed', { err: (err as Error).message })
    }
    try {
      byCount = jobService.pruneTerminalKeepLatestPerType(GC_KEEP_PER_TYPE)
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
    return Object.assign(new Error(`${code}: ${message}`), { code, params, retryable: false })
  }
}
