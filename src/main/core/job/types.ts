import type { LoggerService } from '@main/core/logger/LoggerService'
import type {
  CatchUpPolicy,
  JobError,
  JobSnapshot,
  JobStatus,
  RetryPolicy,
  Trigger
} from '@shared/data/api/schemas/jobs'

import type { JobPayloadOf, JobType } from './jobRegistry'

/**
 * Startup recovery strategy declared at handler registration. Determines how
 * JobManager treats this type's non-terminal jobs after process restart.
 *
 *   - 'abandon'   : all non-terminal jobs → cancelled
 *   - 'retry'     : running → pending (attempt unchanged); delayed stays as-is
 *   - 'singleton' : keep the newest non-terminal; cancel the rest
 */
export type RecoveryStrategy = 'abandon' | 'retry' | 'singleton'

/**
 * Per-job context passed to handler.execute. Provides cancel signal, mutable
 * metadata, progress reporting, and a scoped logger.
 */
export interface JobContext<TPayload = unknown> {
  jobId: string
  input: TPayload
  attempt: number
  signal: AbortSignal
  /** Read-only view of jobTable.metadata at the start of this attempt. */
  metadata: Readonly<Record<string, unknown>>
  /**
   * Shallow-merge a metadata patch and persist immediately. Useful for
   * cross-restart hand-offs (e.g. remote-poll providerTaskId — see
   * handler-authoring.md). Awaiting this call is required before the value is
   * guaranteed durable.
   */
  patchMetadata(patch: Record<string, unknown>): Promise<void>
  /**
   * Report progress (0-100) with optional free-shape detail. Reaches the
   * renderer via CacheService.subscribeSharedChange at jobs.progress.${jobId}.
   */
  reportProgress(progress: number, detail?: unknown): void
  /** Logger pre-bound to { jobId, type }. */
  logger: LoggerService
}

export interface JobMissEvent {
  scheduleId: string
  type: string
  /** Number of fires that were missed during the down period. */
  missedCount: number
  /** Last successful fire time (ms epoch), or null if never run before. */
  lastFireAt: number | null
}

export interface JobSettledEvent {
  jobId: string
  type: string
  scheduleId: string | null
  status: Extract<JobStatus, 'completed' | 'failed' | 'cancelled'>
  output?: unknown
  error: JobError | null
  attempt: number
}

export interface JobHandler<TPayload = unknown> {
  /** Required: startup recovery behavior for non-terminal jobs of this type. */
  recovery: RecoveryStrategy
  /**
   * Default queue resolver. When enqueue does not pass `opts.queue` the handler
   * may pick one based on input (e.g. `base.${input.baseId}` for per-base
   * serialization). Defaults to the type string itself.
   */
  defaultQueue?: (input: TPayload) => string
  /**
   * Per-type concurrency cap. Applies to the type's default queue and any
   * queue resolved by defaultQueue. Defaults to 1.
   */
  defaultConcurrency?: number
  /** Default retry policy. */
  defaultRetryPolicy?: RetryPolicy
  /** Default per-job timeout (ms). */
  defaultTimeoutMs?: number
  /** Grace period to wait for handler to react to AbortSignal after cancel. Defaults to 30000ms. */
  cancelTimeoutMs?: number
  /** Execute one job attempt. Throw to fail; reject with AbortError to cancel. */
  execute(ctx: JobContext<TPayload>): Promise<unknown>
  /** Optional. Called when a schedule fire was missed. */
  onMissed?(event: JobMissEvent): void | Promise<void>
  /** Optional. Called when the job reaches a terminal state. Errors are caught + logged. */
  onSettled?(event: JobSettledEvent): void | Promise<void>
}

/** Strongly-typed handler for a registered job type. */
export type JobHandlerFor<K extends JobType> = JobHandler<JobPayloadOf<K>>

/** Result of `jobManager.enqueue` — id + initial snapshot + terminal promise. */
export interface JobHandle {
  id: string
  snapshot: JobSnapshot
  /**
   * Resolves with the terminal JobSnapshot. Never rejects under normal
   * operation — cancellation / failure surface through `status` on the
   * resolved snapshot. JobManager.onDestroy abandons unresolved Promises
   * (does not reject) — callers that await across shutdown should race with
   * an external timeout.
   */
  finished: Promise<JobSnapshot>
}

export interface EnqueueOptions {
  queue?: string
  priority?: number
  idempotencyKey?: string
  /** ms epoch — when to first attempt (default: now). */
  scheduledAt?: number
  /** When this enqueue is the consequence of a schedule fire. */
  scheduleId?: string
  parentId?: string
  timeoutMs?: number
  maxAttempts?: number
  metadata?: Record<string, unknown>
}

export interface JobScheduleRegistrationInput<K extends JobType = JobType> {
  type: K
  trigger: Trigger
  jobInputTemplate: JobPayloadOf<K>
  catchUpPolicy: CatchUpPolicy
  /** Required for multi-instance types; omit (or null) for single-instance types. */
  name?: string | null
  metadata?: Record<string, unknown>
  /** Default true. */
  enabled?: boolean
}

/** Cache key template constants (registered in cacheSchemas.ts). */
export const JOB_STATE_KEY_PREFIX = 'jobs.state.' as const
export const JOB_PROGRESS_KEY_PREFIX = 'jobs.progress.' as const
