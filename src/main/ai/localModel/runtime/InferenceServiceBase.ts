import { Worker } from 'node:worker_threads'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService } from '@main/core/lifecycle'
import type { LocalModelCapability } from '@shared/data/presets/localModel'
import PQueue from 'p-queue'

import type { SharedArtifactId } from '../catalog/types'
import { localModelStorageService } from '../installation/LocalModelStorageService'
import { resolveLocalInferenceProfile } from './inferenceAcceleration'
import type {
  InferenceInitMessage,
  InferenceRequestMessage,
  InferenceResponse,
  InferenceResultKeyMap,
  LocalInferenceProfileId
} from './protocol'
import { buildInferenceWorkerSource } from './worker/buildWorkerSource'

const INFERENCE_WORKER_IDLE_TIMEOUT_MS = 60 * 1000

type RequestType<TRequests> = Extract<keyof TRequests, string>

interface InferenceServiceSpec<
  TCapability extends LocalModelCapability,
  TRequests,
  TResults extends { [TType in keyof TRequests]: object }
> {
  capability: TCapability
  sharedArtifacts: readonly SharedArtifactId[]
  runtimeModuleSource: string
  workerModuleSource: string
  resultKeys: InferenceResultKeyMap<TRequests, TResults>
}

interface Pending<TRequestType extends string> {
  worker: Worker
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  requestType: TRequestType
  cleanup: () => void
  complete: () => void
}

interface AttemptResult<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  setCancelExecution: (cancel: (() => void) | undefined) => void
}

interface WorkerTermination {
  worker: Worker
  promise: Promise<void>
}

/**
 * Hosts one capability worker. It owns lazy spawn, request serialization, hardware-profile
 * rebuilds, aborts, idle release, and lifecycle teardown; capability code supplies only its
 * protocol, result contract, artifact dependencies, runtime initializer, and worker module.
 */
export abstract class InferenceServiceBase<
  TCapability extends LocalModelCapability,
  TRequests extends { [TType in keyof TRequests]: object },
  TResults extends { [TType in keyof TRequests]: object }
> extends BaseService {
  private worker: Worker | null = null
  private workerProxyVersion: number | null = null
  private workerProfileId: LocalInferenceProfileId | null = null
  private workerGeneration = 0
  private readonly pending = new Map<string, Pending<RequestType<TRequests>>>()
  private readonly queue = new PQueue({ concurrency: 1 })
  private readonly workerSource: string
  private idSeq = 0
  private idleReleaseTimer: NodeJS.Timeout | null = null
  private closing = false
  private workerTermination: WorkerTermination | null = null
  private readonly logger: ReturnType<typeof loggerService.withContext>

  protected constructor(private readonly spec: InferenceServiceSpec<TCapability, TRequests, TResults>) {
    super()
    this.logger = loggerService.withContext(`InferenceService:${spec.capability}`)
    this.workerSource = buildInferenceWorkerSource(spec.runtimeModuleSource, spec.workerModuleSource)
  }

  private async ensureWorker(signal?: AbortSignal): Promise<Worker> {
    if (signal?.aborted) throw this.abortError(signal)
    if (this.closing) throw new Error('inference host is shutting down')
    if (this.workerTermination) await this.workerTermination.promise
    if (signal?.aborted) throw this.abortError(signal)
    if (this.closing) throw new Error('inference host is shutting down')

    const unsupportedArtifact = this.spec.sharedArtifacts.find(
      (id) => !localModelStorageService.isArtifactSupported(id)
    )
    if (unsupportedArtifact) {
      throw new Error(
        `Local ${this.spec.capability} inference is not supported on this platform: ${unsupportedArtifact} is unavailable.`
      )
    }

    const generation = this.workerGeneration
    const proxyRouting = await application.get('ProxyService').getRoutingSnapshot()
    const runtimeProfile = resolveLocalInferenceProfile(
      application.get('PreferenceService').get('feature.local_model.hardware_acceleration.enabled')
    )
    if (signal?.aborted) throw this.abortError(signal)
    if (generation !== this.workerGeneration) throw new Error('inference host terminated')
    if (this.closing) throw new Error('inference host is shutting down')
    if (this.worker && this.workerProxyVersion === proxyRouting.version && this.workerProfileId === runtimeProfile.id) {
      return this.worker
    }
    if (this.worker) {
      await this.terminate()
      if (signal?.aborted) throw this.abortError(signal)
      if (this.workerGeneration !== generation + 1) throw new Error('inference host terminated')
    }
    if (this.closing) throw new Error('inference host is shutting down')

    const worker = new Worker(this.workerSource, { eval: true })
    worker.unref()
    worker.on('message', (message: InferenceResponse) => this.handleMessage(worker, message))
    worker.on('error', (error) => {
      if (this.worker !== worker) return
      const workerError = error instanceof Error ? error : new Error(String(error))
      this.logger.error('inference worker failed', workerError)
      this.workerGeneration += 1
      void this.startWorkerTermination(worker, workerError).catch((terminationError) => {
        this.logger.error('failed to terminate inference worker after an error', this.asError(terminationError))
      })
    })
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.workerGeneration += 1
      this.detachWorker(worker)
      if (code !== 0) this.logger.error('inference worker exited abnormally', new Error(`exit code ${code}`))
      this.finishExitedWorker(worker, new Error(`inference worker exited unexpectedly (code ${code})`))
    })

    const artifactPaths = Object.fromEntries(
      this.spec.sharedArtifacts.map((id) => [id, localModelStorageService.artifactPath(id)])
    )
    const init: InferenceInitMessage<TCapability> = {
      kind: 'init',
      capability: this.spec.capability,
      appPath: application.getPath('app.root'),
      artifactPaths,
      runtimeProfile,
      proxyRouting
    }
    worker.postMessage(init)
    this.worker = worker
    this.workerProxyVersion = proxyRouting.version
    this.workerProfileId = runtimeProfile.id
    return worker
  }

  private handleMessage(worker: Worker, message: InferenceResponse): void {
    switch (message.kind) {
      case 'log': {
        const log =
          message.level === 'warn' ? this.logger.warn : message.level === 'error' ? this.logger.error : this.logger.info
        log.call(this.logger, `[worker] ${message.message}`)
        return
      }
      case 'result': {
        const pending = this.pending.get(message.requestId)
        if (!pending || pending.worker !== worker) return
        this.pending.delete(message.requestId)
        pending.cleanup()
        const payload =
          message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : {}
        const missing = this.spec.resultKeys[pending.requestType].filter((key) => payload[key] === undefined)
        if (missing.length > 0) {
          pending.reject(
            new Error(`inference worker returned a ${pending.requestType} result without ${missing.join(', ')}`)
          )
          pending.complete()
          return
        }
        pending.resolve(payload)
        pending.complete()
        return
      }
      case 'error': {
        const pending = this.pending.get(message.requestId)
        if (!pending || pending.worker !== worker) return
        this.pending.delete(message.requestId)
        pending.cleanup()
        pending.reject(new Error(message.message))
        pending.complete()
      }
    }
  }

  private finishExitedWorker(worker: Worker, error: Error): void {
    const entries = [...this.pending.entries()].filter(([, pending]) => pending.worker === worker)
    if (entries.length > 0) this.logger.error('inference worker failed', error)
    for (const [requestId, pending] of entries) {
      this.pending.delete(requestId)
      pending.cleanup()
      pending.reject(error)
      pending.complete()
    }
  }

  protected send<TType extends RequestType<TRequests>>(
    type: TType,
    payload: TRequests[TType],
    options: { signal?: AbortSignal } = {}
  ): Promise<TResults[TType]> {
    if (options.signal?.aborted) return Promise.reject(this.abortError(options.signal))
    this.clearIdleReleaseTimer()

    let settled = false
    let cancelExecution: (() => void) | undefined
    let resolveResult!: (value: TResults[TType]) => void
    let rejectResult!: (error: Error) => void
    const result = new Promise<TResults[TType]>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const cleanup = () => {
      options.signal?.removeEventListener('abort', abortListener)
    }
    const attemptResult: AttemptResult<TResults[TType]> = {
      resolve: (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolveResult(value)
      },
      reject: (error) => {
        if (settled) return
        settled = true
        cleanup()
        rejectResult(error)
      },
      setCancelExecution: (cancel) => {
        cancelExecution = cancel
      }
    }

    const abortListener = () => {
      const cancel = cancelExecution
      attemptResult.reject(this.abortError(options.signal!))
      cancel?.()
    }
    options.signal?.addEventListener('abort', abortListener, { once: true })
    const execution = this.queue.add(() => this.executeAttempt(type, payload, options, attemptResult))
    void execution.then(
      () => this.scheduleIdleReleaseIfNeeded(),
      (error) => {
        attemptResult.reject(this.asError(error))
        this.scheduleIdleReleaseIfNeeded()
      }
    )
    return result
  }

  private async executeAttempt<TType extends RequestType<TRequests>>(
    type: TType,
    payload: TRequests[TType],
    options: { signal?: AbortSignal },
    result: AttemptResult<TResults[TType]>
  ): Promise<void> {
    if (options.signal?.aborted) return
    try {
      const worker = await this.ensureWorker(options.signal)
      if (options.signal?.aborted) return
      await this.executeWorkerRequest(worker, type, payload, options, result)
    } catch (error) {
      result.reject(this.asError(error))
    }
  }

  private executeWorkerRequest<TType extends RequestType<TRequests>>(
    worker: Worker,
    type: TType,
    payload: TRequests[TType],
    options: { signal?: AbortSignal },
    result: AttemptResult<TResults[TType]>
  ): Promise<void> {
    const requestId = String(++this.idSeq)

    return new Promise<void>((resolveExecution) => {
      let executionComplete = false
      const complete = () => {
        if (executionComplete) return
        executionComplete = true
        resolveExecution()
      }
      const cleanup = () => result.setCancelExecution(undefined)
      const cancelExecution = () => {
        if (this.pending.get(requestId) !== pending) return
        this.pending.delete(requestId)
        cleanup()
        void this.terminate().then(complete, (error) => {
          this.logger.error('failed to terminate an aborted inference worker', this.asError(error))
        })
      }

      const pending: Pending<RequestType<TRequests>> = {
        worker,
        resolve: (value) => result.resolve(value as TResults[TType]),
        reject: result.reject,
        cleanup,
        requestType: type,
        complete
      }
      this.pending.set(requestId, pending)
      result.setCancelExecution(cancelExecution)
      if (options.signal?.aborted) {
        result.reject(this.abortError(options.signal))
        cancelExecution()
        return
      }

      const request: InferenceRequestMessage<TCapability, TType, TRequests[TType]> = {
        kind: 'request',
        capability: this.spec.capability,
        type,
        requestId,
        payload
      }
      try {
        worker.postMessage(request)
      } catch (error) {
        this.pending.delete(requestId)
        cleanup()
        result.reject(this.asError(error))
        complete()
      }
    })
  }

  private abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error('aborted')
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }

  async terminate(): Promise<void> {
    this.clearIdleReleaseTimer()
    this.workerGeneration += 1
    if (this.workerTermination) {
      await this.workerTermination.promise
      return
    }
    if (!this.worker) {
      this.workerProxyVersion = null
      this.workerProfileId = null
      return
    }
    const worker = this.worker
    await this.startWorkerTermination(worker, new Error('inference host terminated'))
  }

  private startWorkerTermination(worker: Worker, error: Error): Promise<void> {
    const existing = this.workerTermination
    if (existing) return existing.promise

    this.detachWorker(worker)
    let termination: Promise<void>
    try {
      termination = worker.terminate().then(() => {})
    } catch (terminationError) {
      termination = Promise.reject(terminationError)
    }
    const record: WorkerTermination = { worker, promise: Promise.resolve() }
    record.promise = termination.finally(() => {
      if (this.workerTermination === record) this.workerTermination = null
    })
    this.workerTermination = record
    this.rejectPendingForTermination(worker, error, record.promise)
    return record.promise
  }

  private rejectPendingForTermination(worker: Worker, error: Error, termination: Promise<void>): void {
    const entries = [...this.pending.entries()].filter(([, pending]) => pending.worker === worker)
    for (const [requestId, pending] of entries) {
      this.pending.delete(requestId)
      pending.cleanup()
      pending.reject(error)
      void termination.then(pending.complete, (terminationError) => {
        this.logger.error('inference worker termination did not reach quiescence', this.asError(terminationError))
      })
    }
  }

  private detachWorker(worker: Worker): void {
    if (this.worker !== worker) return
    this.worker = null
    this.workerProxyVersion = null
    this.workerProfileId = null
  }

  async terminateThen<T>(after: () => Promise<T>): Promise<T> {
    this.closing = true
    try {
      await this.terminate()
      return await after()
    } finally {
      this.closing = false
    }
  }

  protected async onStop(): Promise<void> {
    await this.terminateSafely()
  }

  protected async onDestroy(): Promise<void> {
    await this.terminateSafely()
  }

  private async terminateSafely(): Promise<void> {
    try {
      await this.terminateThen(async () => {})
    } catch (error) {
      this.logger.warn('failed to terminate inference worker during shutdown', error as Error)
    }
  }

  private scheduleIdleReleaseIfNeeded(): void {
    if (!this.worker || this.queue.pending > 0 || this.queue.size > 0) return
    this.clearIdleReleaseTimer()
    this.idleReleaseTimer = setTimeout(() => {
      this.idleReleaseTimer = null
      void this.releaseWorkerIfIdle()
    }, INFERENCE_WORKER_IDLE_TIMEOUT_MS)
    this.idleReleaseTimer.unref()
  }

  private clearIdleReleaseTimer(): void {
    if (!this.idleReleaseTimer) return
    clearTimeout(this.idleReleaseTimer)
    this.idleReleaseTimer = null
  }

  private async releaseWorkerIfIdle(): Promise<void> {
    if (!this.worker || this.queue.pending > 0 || this.queue.size > 0) return
    this.logger.debug('releasing idle inference worker')
    try {
      await this.terminate()
    } catch (error) {
      this.logger.warn('failed to release idle inference worker', this.asError(error))
    }
  }
}
