/**
 * Per-definition engine: one live generation at a time, request correlation, cancellation,
 * the stop / withStopped barriers, idle TTL, and the circuit breaker (RFC §4–5).
 *
 * Constructed with injected deps only — no `@application` / `@logger` — so unit tests drive it
 * with an in-memory adapter and the smoke harness with the real Electron adapter.
 */

import {
  PROTOCOL,
  PROTOCOL_VERSION,
  READY_TIMEOUT_MS,
  SERVICE_NAME_PREFIX,
  STOP_GRACE_MS,
  STOP_TOTAL_MS
} from '../protocol/constants'
import type { FrameIdentity, LogFrame } from '../protocol/frames'
import { isChildFrame, matchesIdentity } from '../protocol/guards'
import type {
  UtilityProcessContract,
  UtilityProcessDefinition,
  UtilityProcessRequestOptions,
  UtilityProcessResetOptions
} from '../types'
import {
  UtilityProcessError,
  type UtilityProcessErrorCode,
  type UtilityProcessErrorDetails
} from '../UtilityProcessError'
import { createUtilityProcessEnvironment } from './environment'
import type { ProcessAdapter, ProcessHandle } from './processAdapter'

/** Consecutive infrastructure failures that open the circuit. */
export const CIRCUIT_FAILURE_THRESHOLD = 3

export interface UtilityProcessHostLogger {
  debug(message: string, ...data: unknown[]): void
  info(message: string, ...data: unknown[]): void
  warn(message: string, ...data: unknown[]): void
  error(message: string, ...data: unknown[]): void
}

export interface ProcessHostDeps {
  adapter: ProcessAdapter
  logger: UtilityProcessHostLogger
  /** Maps a definition's `entry` key to the absolute path of its emitted bundle. */
  resolveEntry: (entry: string) => string
  /** Cherry-scoped temp dir handed to the child as TMPDIR/TEMP/TMP. */
  getTempDir: () => string
}

export interface ChildProcessGoneDetails {
  reason: string
  exitCode: number
  serviceName?: string
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // Waiters attach their own handlers; an unobserved rejection must not crash main.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

type Outcome = { value: unknown } | { error: unknown }

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  onEvent?: (event: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
  /** Terminal frames for this request are dropped; it settles at exit (stop, terminate-cancel). */
  dropTerminals: boolean
  /** Settles with this reason instead of the generation's exit error (terminate-cancel). */
  settleWith: { reason: unknown } | null
}

type GenerationPhase = 'starting' | 'ready' | 'stopping'

interface Generation {
  id: number
  handle: ProcessHandle
  phase: GenerationPhase
  intentionalExit: boolean
  /** Pending and ready have been failed en masse; every later frame is dropped. */
  settled: boolean
  settleError: UtilityProcessError | null
  exited: boolean
  ready: Deferred<void>
  exit: Deferred<number>
  readyTimer: NodeJS.Timeout | null
  killTimer: NodeJS.Timeout | null
  pending: Map<number, Pending>
  /** Cancelled request ids whose late frames are a normal race, not a violation. */
  tombstones: Set<number>
  nextRequestId: number
}

interface SettleSpec {
  code: UtilityProcessErrorCode
  message: string
  countFailure: boolean
  details?: Omit<UtilityProcessErrorDetails, 'processId' | 'generation' | 'failureCount' | 'circuitOpen'>
}

type RequestState = 'pending' | 'tombstone' | 'unknown' | 'duplicate'

export class ProcessHost<Contract extends UtilityProcessContract, InitData> {
  readonly serviceName: string
  private generationCounter = 0
  /** Owned from spawn until the observed exit — never two at once. */
  private live: Generation | null = null
  private failureCount = 0
  private idleTimer: NodeJS.Timeout | null = null
  private stopPromise: Promise<void> | null = null
  private maintenanceChain: Promise<unknown> = Promise.resolve()
  /** > 0 while a withStopped() is enqueued or running: requests fail fast with PROCESS_BLOCKED. */
  private blockedDepth = 0
  private disposed = false

  constructor(
    private readonly definition: UtilityProcessDefinition<Contract, InitData>,
    private readonly deps: ProcessHostDeps
  ) {
    this.serviceName = `${SERVICE_NAME_PREFIX}${definition.id}`
  }

  // ─── Public API (mirrored 1:1 by UtilityProcessClient) ───

  async request<M extends keyof Contract['methods'] & string>(
    method: M,
    input: Contract['methods'][M]['input'],
    options: UtilityProcessRequestOptions<Contract['methods'][M]['event']> = {}
  ): Promise<Contract['methods'][M]['output']> {
    const { signal, onEvent } = options
    for (;;) {
      if (signal?.aborted) throw signal.reason
      if (this.disposed || this.blockedDepth > 0) {
        throw this.error('PROCESS_BLOCKED', 'stopped for maintenance; retry once the operation completes')
      }
      if (this.failureCount >= CIRCUIT_FAILURE_THRESHOLD) {
        throw this.error(
          'PROCESS_CIRCUIT_OPEN',
          `circuit open after ${this.failureCount} consecutive failures; reset with stop({ resetFailures: true })`
        )
      }
      this.clearIdleTimer()
      const generation = this.live ?? this.spawnGeneration()
      if (generation.phase === 'stopping') {
        await abortable(generation.exit.promise, signal)
        continue
      }
      if (generation.phase === 'starting') await abortable(generation.ready.promise, signal)
      if (generation.settled) throw generation.settleError
      if (generation.phase !== 'ready') continue
      return this.dispatch(
        generation,
        method,
        input,
        signal,
        onEvent as ((event: unknown) => void) | undefined
      ) as Promise<Contract['methods'][M]['output']>
    }
  }

  stop(options: UtilityProcessResetOptions = {}): Promise<void> {
    this.clearIdleTimer()
    const applyReset = (): void => {
      if (options.resetFailures) this.failureCount = 0
    }
    if (this.stopPromise !== null) return this.stopPromise.then(applyReset)
    const generation = this.live
    if (generation === null) {
      applyReset()
      return Promise.resolve()
    }
    const barrier: Promise<void> = this.runStopBarrier(generation).finally(() => {
      if (this.stopPromise === barrier) this.stopPromise = null
    })
    this.stopPromise = barrier
    return barrier.then(applyReset)
  }

  withStopped<T>(operation: () => T | Promise<T>, options: UtilityProcessResetOptions = {}): Promise<T> {
    this.blockedDepth += 1
    const run = async (): Promise<T> => {
      try {
        await this.stop()
        const result = await operation()
        if (options.resetFailures) this.failureCount = 0
        return result
      } finally {
        this.blockedDepth -= 1
      }
    }
    const next = this.maintenanceChain.then(run, run)
    this.maintenanceChain = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  /** Terminal: stops the live generation and blocks every later request. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.clearIdleTimer()
    try {
      await this.stop()
    } catch (error) {
      this.deps.logger.warn(`[${this.definition.id}] stop during dispose failed`, error)
    }
  }

  /** Resolves once no generation is live: at once, or at the live generation's observed exit. */
  whenQuiescent(): Promise<void> {
    const generation = this.live
    if (generation === null) return Promise.resolve()
    return generation.exit.promise.then(() => this.whenQuiescent())
  }

  /** Diagnostics only: `child-process-gone` never drives a transition (the wrapper's exit does). */
  noteChildProcessGone(details: ChildProcessGoneDetails): void {
    if (details.serviceName !== this.serviceName) return
    const target = this.live === null ? this.definition.id : this.tag(this.live)
    this.deps.logger.info(`[${target}] child-process-gone: reason=${details.reason} exitCode=${details.exitCode}`)
  }

  // ─── Generation lifecycle ───

  private spawnGeneration(): Generation {
    this.generationCounter += 1
    const id = this.generationCounter
    let handle: ProcessHandle
    // Kicked off before the fork so an async factory resolves while the process launches;
    // wrapped at once so a rejection is never left unobserved when the spawn fails.
    let initData: Promise<Outcome>
    let entryPath: string
    try {
      const env = createUtilityProcessEnvironment({ tempDir: this.deps.getTempDir() }, this.definition.createEnv?.())
      initData = Promise.resolve(this.definition.createInitData?.()).then(
        (value) => ({ value }),
        (error) => ({ error })
      )
      entryPath = this.deps.resolveEntry(this.definition.entry)
      handle = this.deps.adapter.spawn({ entryPath, env, serviceName: this.serviceName })
    } catch (cause) {
      this.failureCount += 1
      const error = this.error('PROCESS_START_FAILED', `generation ${id} failed to spawn: ${describe(cause)}`, {
        generation: id,
        cause
      })
      this.deps.logger.error(`[${this.definition.id}#${id}] spawn failed`, error)
      throw error
    }
    const generation: Generation = {
      id,
      handle,
      phase: 'starting',
      intentionalExit: false,
      settled: false,
      settleError: null,
      exited: false,
      ready: createDeferred<void>(),
      exit: createDeferred<number>(),
      readyTimer: null,
      killTimer: null,
      pending: new Map(),
      tombstones: new Set(),
      nextRequestId: 1
    }
    this.live = generation
    generation.readyTimer = setTimeout(() => {
      this.settleGeneration(generation, {
        code: 'PROCESS_START_FAILED',
        message: `generation ${id} did not become ready within ${READY_TIMEOUT_MS} ms`,
        countFailure: true
      })
    }, READY_TIMEOUT_MS)
    generation.readyTimer.unref?.()
    handle.onSpawn(() => {
      // A stop or settle that landed before spawn could not kill (no pid yet): kill now, never connect.
      if (generation.phase !== 'starting') {
        if (!generation.exited) generation.handle.kill()
        return
      }
      void this.connectGeneration(generation, initData)
    })
    handle.onMessage((data) => this.handleFrame(generation, data))
    handle.onExit((code) => this.handleExit(generation, code))
    handle.onStdoutLine((line, truncated) =>
      this.deps.logger.debug(`[${this.tag(generation)}] stdout: ${line}${truncated ? ' …[truncated]' : ''}`)
    )
    handle.onStderrLine((line, truncated) =>
      this.deps.logger.warn(`[${this.tag(generation)}] stderr: ${line}${truncated ? ' …[truncated]' : ''}`)
    )
    handle.onError((info) =>
      this.deps.logger.error(`[${this.tag(generation)}] process error (${info.type}) at ${info.location}`, {
        report: info.report
      })
    )
    this.deps.logger.info(`[${this.tag(generation)}] spawned`, { entryPath })
    return generation
  }

  /** Awaits the init data outcome and hands the child its private port. */
  private async connectGeneration(generation: Generation, pendingInitData: Promise<Outcome>): Promise<void> {
    const outcome = await pendingInitData
    // A stop that landed meanwhile owns the generation; its exit settles the waiters.
    if (generation.phase !== 'starting') return
    if ('error' in outcome) {
      this.settleGeneration(generation, {
        code: 'PROCESS_START_FAILED',
        message: `generation ${generation.id} init data failed: ${describe(outcome.error)}`,
        countFailure: true,
        details: { cause: outcome.error }
      })
      return
    }
    try {
      generation.handle.connect({ ...this.identity(generation), kind: 'connect', initData: outcome.value })
    } catch (cause) {
      this.settleGeneration(generation, {
        code: 'PROCESS_START_FAILED',
        message: `generation ${generation.id} init data is not structured-cloneable: ${describe(cause)}`,
        countFailure: true,
        details: { cause }
      })
    }
  }

  private handleFrame(generation: Generation, data: unknown): void {
    if (generation.settled) return
    if (!isChildFrame(data) || !matchesIdentity(data, this.identity(generation))) {
      this.violation(generation, 'malformed or foreign frame')
      return
    }
    switch (data.kind) {
      case 'ready': {
        // A ready that lands during an intentional stop is a race, not a violation; the exit settles it.
        if (generation.phase === 'stopping') return
        if (generation.phase !== 'starting') {
          this.violation(generation, 'duplicate ready')
          return
        }
        generation.phase = 'ready'
        this.clearTimer(generation, 'readyTimer')
        this.deps.logger.info(`[${this.tag(generation)}] ready`)
        generation.ready.resolve()
        this.maybeArmIdle(generation)
        return
      }
      case 'startup-error': {
        if (generation.phase !== 'starting') {
          this.violation(generation, 'startup-error after ready')
          return
        }
        this.settleGeneration(generation, {
          code: 'PROCESS_START_FAILED',
          message: `initialize failed: ${data.error.message}`,
          countFailure: true,
          details: { remote: data.error }
        })
        return
      }
      case 'protocol-error': {
        this.settleGeneration(generation, {
          code: 'PROCESS_PROTOCOL_ERROR',
          message: `child reported a protocol violation: ${data.message}`,
          countFailure: true
        })
        return
      }
      case 'log': {
        this.relayLog(generation, data)
        return
      }
      case 'event': {
        if (this.classify(generation, data.requestId, 'event') !== 'pending') return
        const pending = generation.pending.get(data.requestId)!
        if (pending.dropTerminals || pending.onEvent === undefined) return
        try {
          pending.onEvent(data.event)
        } catch (error) {
          // The callback may have re-entrantly aborted or stopped; only cancel what is still pending.
          if (generation.pending.get(data.requestId) === pending) this.cancelRequest(generation, data.requestId, error)
        }
        return
      }
      case 'result':
      case 'error': {
        const state = this.classify(generation, data.requestId, data.kind)
        if (state === 'unknown' || state === 'duplicate') return
        // Any well-formed terminal proves spawn, handshake, and dispatch all work (RFC §5.2).
        this.failureCount = 0
        if (state === 'tombstone') {
          generation.tombstones.delete(data.requestId)
          return
        }
        const pending = generation.pending.get(data.requestId)!
        if (pending.dropTerminals) return
        if (data.kind === 'result') {
          this.settlePending(generation, data.requestId, { value: data.output })
        } else {
          this.settlePending(generation, data.requestId, {
            error: this.error('PROCESS_REMOTE_ERROR', data.error.message, {
              generation: generation.id,
              remote: data.error
            })
          })
        }
        return
      }
    }
  }

  /** Classifies a child frame's requestId; unknown and duplicate ids are fatal violations. */
  private classify(generation: Generation, requestId: number, kind: string): RequestState {
    if (generation.pending.has(requestId)) return 'pending'
    if (generation.tombstones.has(requestId)) return 'tombstone'
    if (requestId >= generation.nextRequestId) {
      this.violation(generation, `${kind} for unknown request ${requestId}`)
      return 'unknown'
    }
    this.violation(generation, `${kind} for already settled request ${requestId}`)
    return 'duplicate'
  }

  private handleExit(generation: Generation, code: number): void {
    if (generation.exited) return
    generation.exited = true
    this.clearTimer(generation, 'killTimer')
    if (this.live === generation) this.live = null
    if (!generation.settled) {
      if (generation.intentionalExit) {
        this.settleGeneration(generation, {
          code: 'PROCESS_EXITED',
          message: `generation ${generation.id} exited (code ${code}) as requested`,
          countFailure: false,
          details: { exitCode: code, intentional: true }
        })
      } else if (generation.phase === 'starting') {
        this.settleGeneration(generation, {
          code: 'PROCESS_START_FAILED',
          message: `generation ${generation.id} exited with code ${code} before becoming ready`,
          countFailure: true,
          details: { exitCode: code }
        })
      } else {
        this.settleGeneration(generation, {
          code: 'PROCESS_EXITED',
          message: `generation ${generation.id} exited unexpectedly with code ${code}`,
          countFailure: true,
          details: { exitCode: code, intentional: false }
        })
      }
    }
    this.deps.logger.info(`[${this.tag(generation)}] exited`, {
      exitCode: code,
      intentional: generation.intentionalExit
    })
    generation.exit.resolve(code)
  }

  /**
   * The single funnel that fails a generation's pending requests and cold-start waiters —
   * exactly once — and kills the process if it has not exited yet.
   */
  private settleGeneration(generation: Generation, spec: SettleSpec): void {
    if (generation.settled) return
    generation.settled = true
    this.clearTimer(generation, 'readyTimer')
    if (spec.countFailure) this.failureCount += 1
    const error = this.error(spec.code, spec.message, { ...spec.details, generation: generation.id })
    generation.settleError = error
    generation.phase = 'stopping'
    generation.ready.reject(error)
    for (const [requestId, pending] of [...generation.pending]) {
      this.settlePending(generation, requestId, {
        error: pending.settleWith !== null ? pending.settleWith.reason : error
      })
    }
    generation.tombstones.clear()
    if (spec.countFailure) this.deps.logger.error(`[${this.tag(generation)}] ${spec.message}`, error)
    else this.deps.logger.debug(`[${this.tag(generation)}] ${spec.message}`)
    if (!generation.exited) generation.handle.kill()
  }

  private violation(generation: Generation, message: string): void {
    this.settleGeneration(generation, {
      code: 'PROCESS_PROTOCOL_ERROR',
      message: `protocol violation: ${message}`,
      countFailure: true
    })
  }

  // ─── Requests ───

  private dispatch(
    generation: Generation,
    method: string,
    input: unknown,
    signal: AbortSignal | undefined,
    onEvent: ((event: unknown) => void) | undefined
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      this.clearIdleTimer()
      const requestId = generation.nextRequestId
      generation.nextRequestId += 1
      const pending: Pending = { resolve, reject, onEvent, signal, dropTerminals: false, settleWith: null }
      generation.pending.set(requestId, pending)
      try {
        generation.handle.send({ ...this.identity(generation), kind: 'request', requestId, method, input })
      } catch (cause) {
        generation.pending.delete(requestId)
        reject(
          this.error('PROCESS_SERIALIZATION_FAILED', `input for '${method}' is not structured-cloneable`, {
            generation: generation.id,
            cause
          })
        )
        this.maybeArmIdle(generation)
        return
      }
      if (signal !== undefined) {
        pending.onAbort = () => this.cancelRequest(generation, requestId, signal.reason)
        signal.addEventListener('abort', pending.onAbort, { once: true })
      }
    })
  }

  private cancelRequest(generation: Generation, requestId: number, reason: unknown): void {
    const pending = generation.pending.get(requestId)
    if (pending === undefined) return
    if (this.definition.cancellation === 'cooperative') {
      this.settlePending(generation, requestId, { error: reason })
      generation.tombstones.add(requestId)
      if (generation.phase !== 'ready' || generation.settled) return
      try {
        generation.handle.send({ ...this.identity(generation), kind: 'cancel', requestId })
      } catch {
        // The generation is dying; its exit settles everything.
      }
      return
    }
    if (pending.settleWith !== null) return
    pending.dropTerminals = true
    pending.settleWith = { reason }
    if (generation.phase === 'stopping') return
    generation.intentionalExit = true
    generation.phase = 'stopping'
    this.deps.logger.info(`[${this.tag(generation)}] terminating to cancel request ${requestId}`)
    if (!generation.exited) generation.handle.kill()
  }

  /** The only place a pending entry is removed and its promise settled. */
  private settlePending(generation: Generation, requestId: number, outcome: Outcome): void {
    const pending = generation.pending.get(requestId)
    if (pending === undefined) return
    generation.pending.delete(requestId)
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener('abort', pending.onAbort)
    }
    if ('error' in outcome) pending.reject(outcome.error)
    else pending.resolve(outcome.value)
    this.maybeArmIdle(generation)
  }

  // ─── Stop barrier ───

  private async runStopBarrier(generation: Generation): Promise<void> {
    generation.intentionalExit = true
    const graceful = generation.phase === 'ready' && !generation.settled
    generation.phase = 'stopping'
    for (const pending of generation.pending.values()) pending.dropTerminals = true
    if (graceful) {
      try {
        generation.handle.send({ ...this.identity(generation), kind: 'shutdown' })
      } catch {
        generation.handle.kill()
      }
      generation.killTimer = setTimeout(() => {
        if (!generation.exited) generation.handle.kill()
      }, STOP_GRACE_MS)
    } else {
      // A starting generation must not hit its ready deadline mid-stop and count a failure.
      this.clearTimer(generation, 'readyTimer')
      if (!generation.exited) generation.handle.kill()
    }
    const timeout = createDeferred<never>()
    const stopTimer = setTimeout(() => timeout.reject(new Error('stop timeout')), STOP_TOTAL_MS)
    try {
      await Promise.race([generation.exit.promise, timeout.promise])
    } catch {
      if (generation.exited) return
      const message = `generation ${generation.id} did not exit within ${STOP_TOTAL_MS} ms after stop; quarantined until it exits`
      this.settleGeneration(generation, { code: 'PROCESS_STOP_FAILED', message, countFailure: false })
      throw this.error('PROCESS_STOP_FAILED', message, { generation: generation.id })
    } finally {
      clearTimeout(stopTimer)
      this.clearTimer(generation, 'killTimer')
    }
  }

  // ─── Idle TTL ───

  private isIdle(generation: Generation): boolean {
    return (
      this.live === generation &&
      generation.phase === 'ready' &&
      !generation.settled &&
      generation.pending.size === 0 &&
      this.stopPromise === null &&
      this.blockedDepth === 0 &&
      !this.disposed
    )
  }

  private maybeArmIdle(generation: Generation): void {
    const idleTimeoutMs = this.definition.idleTimeoutMs
    if (idleTimeoutMs === undefined || !this.isIdle(generation)) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (!this.isIdle(generation)) return
      this.deps.logger.info(`[${this.tag(generation)}] idle for ${idleTimeoutMs} ms; stopping`)
      this.stop().catch((error) => this.deps.logger.warn(`[${this.tag(generation)}] idle stop failed`, error))
    }, idleTimeoutMs)
    this.idleTimer.unref?.()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer === null) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  // ─── Helpers ───

  private relayLog(generation: Generation, frame: LogFrame): void {
    const fields: Record<string, unknown> = {
      ...frame.fields,
      processId: this.definition.id,
      generation: generation.id,
      pid: generation.handle.pid
    }
    if (frame.requestId !== undefined) fields.requestId = frame.requestId
    this.deps.logger[frame.level](`[${this.tag(generation)}] ${frame.message}`, fields)
  }

  private identity(generation: Generation): FrameIdentity {
    return { protocol: PROTOCOL, version: PROTOCOL_VERSION, processId: this.definition.id, generation: generation.id }
  }

  private tag(generation: Generation): string {
    return `${this.definition.id}#${generation.id}`
  }

  private clearTimer(generation: Generation, key: 'readyTimer' | 'killTimer'): void {
    const timer = generation[key]
    if (timer === null) return
    clearTimeout(timer)
    generation[key] = null
  }

  private error(
    code: UtilityProcessErrorCode,
    message: string,
    details: Omit<UtilityProcessErrorDetails, 'processId' | 'failureCount' | 'circuitOpen'> = {}
  ): UtilityProcessError {
    return new UtilityProcessError(code, `utility process '${this.definition.id}': ${message}`, {
      ...details,
      processId: this.definition.id,
      failureCount: this.failureCount,
      circuitOpen: this.failureCount >= CIRCUIT_FAILURE_THRESHOLD
    })
  }
}
