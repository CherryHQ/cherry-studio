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
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  requestType: TRequestType
  cleanup: () => void
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
  private readonly logger: ReturnType<typeof loggerService.withContext>

  protected constructor(private readonly spec: InferenceServiceSpec<TCapability, TRequests, TResults>) {
    super()
    this.logger = loggerService.withContext(`InferenceService:${spec.capability}`)
    this.workerSource = buildInferenceWorkerSource(spec.runtimeModuleSource, spec.workerModuleSource)
  }

  private async ensureWorker(): Promise<Worker> {
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
    if (generation !== this.workerGeneration) throw new Error('inference host terminated')
    if (this.closing) throw new Error('inference host is shutting down')
    if (this.worker && this.workerProxyVersion === proxyRouting.version && this.workerProfileId === runtimeProfile.id) {
      return this.worker
    }
    if (this.worker) {
      await this.terminate()
      if (this.workerGeneration !== generation + 1) throw new Error('inference host terminated')
    }
    if (this.closing) throw new Error('inference host is shutting down')

    const worker = new Worker(this.workerSource, { eval: true })
    worker.unref()
    worker.on('message', (message: InferenceResponse) => this.handleMessage(message))
    worker.on('error', (error) => {
      if (this.worker !== worker) return
      this.worker = null
      this.workerProxyVersion = null
      this.workerProfileId = null
      const workerError = error instanceof Error ? error : new Error(String(error))
      if (this.pending.size === 0) this.logger.error('inference worker failed', workerError)
      this.failAll(workerError)
    })
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.worker = null
      this.workerProxyVersion = null
      this.workerProfileId = null
      if (code !== 0) this.logger.error('inference worker exited abnormally', new Error(`exit code ${code}`))
      this.failAll(new Error(`inference worker exited unexpectedly (code ${code})`))
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

  private handleMessage(message: InferenceResponse): void {
    switch (message.kind) {
      case 'log': {
        const log =
          message.level === 'warn' ? this.logger.warn : message.level === 'error' ? this.logger.error : this.logger.info
        log.call(this.logger, `[worker] ${message.message}`)
        return
      }
      case 'result': {
        const pending = this.pending.get(message.requestId)
        if (!pending) return
        this.pending.delete(message.requestId)
        pending.cleanup()
        const payload =
          message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : {}
        const missing = this.spec.resultKeys[pending.requestType].filter((key) => payload[key] === undefined)
        if (missing.length > 0) {
          pending.reject(
            new Error(`inference worker returned a ${pending.requestType} result without ${missing.join(', ')}`)
          )
          return
        }
        pending.resolve(payload)
        return
      }
      case 'error': {
        const pending = this.pending.get(message.requestId)
        if (!pending) return
        this.pending.delete(message.requestId)
        pending.cleanup()
        pending.reject(new Error(message.message))
      }
    }
  }

  private failAll(error: Error): void {
    if (this.pending.size === 0) return
    this.logger.error('inference worker failed', error)
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pending.clear()
  }

  protected async send<TType extends RequestType<TRequests>>(
    type: TType,
    payload: TRequests[TType],
    options: { signal?: AbortSignal } = {}
  ): Promise<TResults[TType]> {
    if (options.signal?.aborted) throw this.abortError(options.signal)
    this.clearIdleReleaseTimer()
    try {
      const result = await this.queue.add(() => this.sendNow(type, payload, options))
      if (result === undefined) throw new Error('inference request queue did not return a result')
      return result
    } finally {
      this.scheduleIdleReleaseIfNeeded()
    }
  }

  private async sendNow<TType extends RequestType<TRequests>>(
    type: TType,
    payload: TRequests[TType],
    options: { signal?: AbortSignal }
  ): Promise<TResults[TType]> {
    if (options.signal?.aborted) throw this.abortError(options.signal)
    const worker = await this.ensureWorker()
    const requestId = String(++this.idSeq)

    return new Promise<TResults[TType]>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(this.abortError(options.signal))
        return
      }
      const onAbort = () => {
        if (!this.pending.has(requestId)) return
        this.pending.delete(requestId)
        reject(this.abortError(options.signal!))
      }
      const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
      this.pending.set(requestId, {
        resolve: (result) => resolve(result as TResults[TType]),
        reject,
        cleanup,
        requestType: type
      })
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const request: InferenceRequestMessage<TCapability, TType, TRequests[TType]> = {
        kind: 'request',
        capability: this.spec.capability,
        type,
        requestId,
        payload
      }
      worker.postMessage(request)
    })
  }

  private abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error('aborted')
  }

  async terminate(): Promise<void> {
    this.clearIdleReleaseTimer()
    this.workerGeneration += 1
    if (!this.worker) {
      this.workerProxyVersion = null
      this.workerProfileId = null
      return
    }
    const worker = this.worker
    this.worker = null
    this.workerProxyVersion = null
    this.workerProfileId = null
    this.failAll(new Error('inference host terminated'))
    await worker.terminate()
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
    await this.terminateSafely()
  }
}
