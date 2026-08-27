import { Worker } from 'node:worker_threads'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService } from '@main/core/lifecycle'
import { isDarwinX64 } from '@main/core/platform'
import type { LocalModelCapability } from '@shared/data/presets/localModel'
import PQueue from 'p-queue'

import { localModelRegistry } from '../registry/LocalModelRegistry'
import { resolveLocalInferenceProfile } from './inferenceAcceleration'
import type {
  InferenceInitMessage,
  InferenceRequest,
  InferenceRequestType,
  InferenceResponse,
  InferenceResultPayloads,
  LocalInferenceProfileId
} from './protocol/envelope'
import { INFERENCE_RESULT_KEYS } from './protocol/envelope'
import { inferenceWorkerSource } from './workerSource/buildWorkerSource'

const INFERENCE_WORKER_IDLE_TIMEOUT_MS = 60 * 1000

/** Per-member Omit so union variants keep their own fields (built-in Omit drops them). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

interface Pending {
  /** The request's own payload type is restored by {@link InferenceServiceBase.send};
   * `pending` holds every capability's at once and cannot name one. */
  resolve: (payload: never) => void
  reject: (err: Error) => void
  /** What was asked, so the arrival check in `handleMessage` knows which payload keys
   * the worker owed (and can name the request in the failure). */
  requestType: InferenceRequestType
  /** Detaches the abort listener `sendNow` registered (a no-op once it has
   * already fired, since it's `{ once: true }`). */
  cleanup: () => void
}

/**
 * Owns a single `worker_threads` worker that runs onnxruntime-node inference off
 * the main thread. Embedding and OCR get their own instance each (see
 * {@link EmbeddingInferenceService}/{@link OcrInferenceService}), so
 * cancelling/removing one model's download can never collaterally reject the
 * other's in-flight request or evict its loaded pipeline — they don't share a
 * thread, a `pending` map, or a `terminate()`.
 *
 * The worker source, the wire protocol, and the public method signatures are
 * all process-agnostic: moving to an Electron `utilityProcess` per capability (for
 * crash isolation) later touches only the spawn/teardown internals here.
 *
 * Lifecycle-managed: the worker is a real OS thread that must not outlive a
 * clean shutdown. Spawning stays fully lazy (on first `send()`), so `onInit()`
 * has nothing to do — only `onStop()`/`onDestroy()` are meaningful, both
 * releasing the worker via the same `terminateThen`-guarded teardown, which
 * also blocks a request already queued behind the terminated one from
 * respawning a worker before shutdown finishes. A loaded model (up to
 * 600MB+) is also released after a period of inactivity, mirroring
 * {@link TesseractRuntimeService}'s idle-release timer.
 *
 * Requests are also serialized one-at-a-time through the shared worker (same
 * `concurrency: 1` queue {@link TesseractRuntimeService} uses): a single CPU
 * onnxruntime/PaddleOCR session gains nothing from concurrent calls, and
 * multiple knowledge bases (or files) can independently reach the same
 * instance's `embed()`/`recognize()` at once with no other coordination.
 */
export abstract class InferenceServiceBase extends BaseService {
  private worker: Worker | null = null
  private workerProxyVersion: number | null = null
  // Tracks worker creation; worker-local CPU fallback deliberately does not update it.
  private workerProfileId: LocalInferenceProfileId | null = null
  private workerGeneration = 0
  private readonly pending = new Map<string, Pending>()
  private readonly queue = new PQueue({ concurrency: 1 })
  private idSeq = 0
  private idleReleaseTimer: NodeJS.Timeout | null = null
  /** Set for the duration of {@link terminateThen}'s `after` callback — blocks
   * `ensureWorker` from spawning a replacement while on-disk weights are being
   * deleted right after teardown. */
  private closing = false
  private readonly logger: ReturnType<typeof loggerService.withContext>

  protected constructor(capability: LocalModelCapability) {
    super()
    this.logger = loggerService.withContext(`InferenceService:${capability}`)
  }

  private async ensureWorker(): Promise<Worker> {
    if (this.closing) {
      throw new Error('inference host is shutting down')
    }
    // Last line of defense: the settings/KB cards already hide on Intel Mac (see
    // BundleInstallManager.getStatusInfo), but this is the spawn point every
    // caller (embed/countTokens/recognize, including the OCR agent tool)
    // funnels through, so anything that reaches it programmatically fails fast
    // instead of loading a worker that will crash on the missing native binding.
    if (isDarwinX64) {
      throw new Error(
        'Local model inference is not supported on Intel Mac (darwin x64) — onnxruntime-node ships no darwin-x64 binding.'
      )
    }
    const generation = this.workerGeneration
    const proxyRouting = await application.get('ProxyService').getRoutingSnapshot()
    const runtimeProfile = resolveLocalInferenceProfile(
      application.get('PreferenceService').get('feature.local_model.hardware_acceleration.enabled')
    )
    if (generation !== this.workerGeneration) {
      throw new Error('inference host terminated')
    }
    if (this.closing) {
      throw new Error('inference host is shutting down')
    }
    if (this.worker && this.workerProxyVersion === proxyRouting.version && this.workerProfileId === runtimeProfile.id) {
      return this.worker
    }
    if (this.worker) {
      await this.terminate()
      if (this.workerGeneration !== generation + 1) {
        throw new Error('inference host terminated')
      }
    }
    if (this.closing) {
      throw new Error('inference host is shutting down')
    }
    const worker = new Worker(inferenceWorkerSource, { eval: true })
    // Inference is opt-in; a loaded 600MB+ model must never keep the app alive on quit.
    worker.unref()
    worker.on('message', (msg: InferenceResponse) => this.handleMessage(msg))
    worker.on('error', (err) => {
      // Ignore a superseded worker: terminate() nulled this.worker and a newer worker may
      // be live, so its requests must not be rejected by an old worker's error.
      if (this.worker !== worker) return
      this.failAll(err instanceof Error ? err : new Error(String(err)))
    })
    worker.on('exit', (code) => {
      // Ignore a superseded worker's late exit: terminate() nulls this.worker and a new
      // worker may already be live, so acting here would clear the new worker's reference
      // and reject its in-flight requests. The old worker's own pending were already
      // failed when it was torn down.
      if (this.worker !== worker) return
      this.worker = null
      this.workerProxyVersion = null
      this.workerProfileId = null
      // A non-zero exit is an abnormal crash (native onnxruntime fault, OOM kill). Log it
      // unconditionally — failAll's no-op-when-idle guard below would otherwise swallow the
      // only crash breadcrumb when nothing is pending, leaving the auto-respawn invisible.
      if (code !== 0) this.logger.error('inference worker exited abnormally', new Error(`exit code ${code}`))
      // A clean (code 0) exit with requests still in flight would otherwise hang their
      // promises forever. failAll no-ops when nothing is pending (the normal terminate()
      // path), so this never double-reports.
      this.failAll(new Error(`inference worker exited unexpectedly (code ${code})`))
    })
    const init: InferenceInitMessage = {
      type: 'init',
      appPath: application.getPath('app.root'),
      onnxRuntimeBindingPath: localModelRegistry.artifactPath('onnxruntime-node'),
      runtimeProfile,
      proxyRouting
    }
    worker.postMessage(init)
    this.worker = worker
    this.workerProxyVersion = proxyRouting.version
    this.workerProfileId = runtimeProfile.id
    return worker
  }

  private handleMessage(msg: InferenceResponse): void {
    switch (msg.type) {
      case 'log': {
        const log =
          msg.level === 'warn' ? this.logger.warn : msg.level === 'error' ? this.logger.error : this.logger.info
        log.call(this.logger, `[worker] ${msg.message}`)
        return
      }
      case 'result': {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        pending.cleanup()
        const payload: Record<string, unknown> = msg.payload ?? {}
        const missing = INFERENCE_RESULT_KEYS[pending.requestType].filter((key) => payload[key] === undefined)
        // A worker that answers without what it promised is a protocol violation, not an
        // empty result: resolving it would hand a caller `undefined` where it declared a
        // value — embedding nothing, and indexing it as real.
        if (missing.length > 0) {
          pending.reject(
            new Error(`inference worker returned a ${pending.requestType} result without ${missing.join(', ')}`)
          )
          return
        }
        pending.resolve(payload as never)
        return
      }
      case 'error': {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        pending.cleanup()
        pending.reject(new Error(msg.message))
        return
      }
    }
  }

  private failAll(err: Error): void {
    // No-op when idle so an intentional terminate() (or a second exit/error event)
    // doesn't log a spurious "worker failed" with nothing to reject.
    if (this.pending.size === 0) return
    this.logger.error('inference worker failed', err)
    for (const [, pending] of this.pending) {
      pending.cleanup()
      pending.reject(err)
    }
    this.pending.clear()
  }

  /** Send one request and resolve with that request type's own payload. */
  protected async send<T extends InferenceRequestType>(
    request: Extract<DistributiveOmit<InferenceRequest, 'id'>, { type: T }>,
    opts: { signal?: AbortSignal } = {}
  ): Promise<InferenceResultPayloads[T]> {
    // Fail fast on an already-aborted signal rather than occupying a queue slot
    // (sendNow's own check below only fires once this request reaches the front).
    if (opts.signal?.aborted) {
      throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error('aborted')
    }
    this.clearIdleReleaseTimer()
    try {
      const result = await this.queue.add(() => this.sendNow<T>(request, opts))
      if (!result) throw new Error('inference request queue did not return a result')
      return result
    } finally {
      this.scheduleIdleReleaseIfNeeded()
    }
  }

  private async sendNow<T extends InferenceRequestType>(
    request: Extract<DistributiveOmit<InferenceRequest, 'id'>, { type: T }>,
    opts: { signal?: AbortSignal }
  ): Promise<InferenceResultPayloads[T]> {
    if (opts.signal?.aborted) {
      throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error('aborted')
    }
    const worker = await this.ensureWorker()
    const id = String(++this.idSeq)
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(opts.signal.reason instanceof Error ? opts.signal.reason : new Error('aborted'))
        return
      }
      const onAbort = () => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(opts.signal?.reason instanceof Error ? opts.signal.reason : new Error('aborted'))
      }
      const cleanup = () => opts.signal?.removeEventListener('abort', onAbort)
      this.pending.set(id, { resolve, reject, cleanup, requestType: request.type })
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      worker.postMessage({ ...request, id } as InferenceRequest)
    })
  }

  /**
   * Kill the worker (cancels any in-flight download and frees the model).
   * Pending requests reject immediately, but the returned promise only
   * resolves once the OS thread has actually exited — callers that delete
   * on-disk weights right after (releasing a Windows file lock) must await
   * this first, or the delete can race the worker's teardown.
   */
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

  /**
   * Terminates the worker, then runs `after` (e.g. deleting the now-unheld
   * on-disk weights) while blocking any request from spawning a replacement
   * worker in the meantime. A bare `terminate()` only rejects the one request
   * already in `pending` — a second request already queued behind it (or a
   * brand new one from an unrelated caller) would otherwise dequeue right
   * after, see `this.worker === null`, and silently respawn a worker that
   * reads/writes the very files `after` is deleting.
   */
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

  /** Swallow-and-log (mirrors TesseractRuntimeService's disposeWorkerSafely) so a
   * rejecting terminate() can't leave this service's lifecycle state stuck mid-shutdown.
   * Goes through terminateThen (not a bare terminate()) so the `closing` guard covers the
   * whole shutdown: a request queued behind the one terminate() rejects would otherwise
   * dequeue right after, see `this.worker === null`, and respawn a worker mid-shutdown. */
  private async terminateSafely(): Promise<void> {
    try {
      await this.terminateThen(async () => {})
    } catch (error) {
      this.logger.warn('failed to terminate inference worker during shutdown', error as Error)
    }
  }

  /** Arms the idle-release timer once a request settles and nothing else is queued or in
   * flight (mirrors TesseractRuntimeService's scheduleIdleWorkerReleaseIfNeeded). */
  private scheduleIdleReleaseIfNeeded(): void {
    if (!this.worker || this.queue.pending > 0 || this.queue.size > 0) return
    this.clearIdleReleaseTimer()
    this.idleReleaseTimer = setTimeout(() => {
      this.idleReleaseTimer = null
      void this.releaseWorkerIfIdle()
    }, INFERENCE_WORKER_IDLE_TIMEOUT_MS)
    // Symmetric with the worker's own unref() — a scheduled release must never
    // keep the app alive on quit either.
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
