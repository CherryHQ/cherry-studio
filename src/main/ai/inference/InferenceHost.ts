import { Worker } from 'node:worker_threads'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isDarwinX64 } from '@main/core/platform'
import { onnxRuntimeBinaryService } from '@main/features/localModel/OnnxRuntimeBinaryService'
import type { LocalModelKind } from '@shared/data/presets/localModel'
import PQueue from 'p-queue'

import type { InferenceModelSource, InferenceRequest, InferenceResponse, OcrModelPaths } from './inferenceProtocol'
import { inferenceWorkerSource } from './inferenceWorkerSource'

const INFERENCE_WORKER_IDLE_TIMEOUT_MS = 60 * 1000

/** Per-member Omit so union variants keep their own fields (built-in Omit drops them). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export interface InferenceProgress {
  status: string
  file?: string
  loaded?: number
  total?: number
  /** 0–100. */
  progress?: number
}

/** One worker `result` message, narrowed to the field the caller cares about. */
interface InferenceResult {
  embeddings?: number[][] | null
  text?: string | null
}

interface Pending {
  resolve: (result: InferenceResult) => void
  reject: (err: Error) => void
  onProgress?: (p: InferenceProgress) => void
  /** Detaches the abort listener `sendNow` registered (a no-op once it has
   * already fired, since it's `{ once: true }`). */
  cleanup: () => void
}

/**
 * Owns a single `worker_threads` worker that runs onnxruntime-node inference off
 * the main thread. Embedding and OCR get their own instance each (see
 * {@link EmbeddingInferenceHost}/{@link OcrInferenceHost} below), so
 * cancelling/removing one model's download can never collaterally reject the
 * other's in-flight request or evict its loaded pipeline — they don't share a
 * thread, a `pending` map, or a `terminate()`.
 *
 * The worker source, the wire protocol, and the public method signatures are
 * all process-agnostic: moving to an Electron `utilityProcess` per kind (for
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
abstract class InferenceHostBase extends BaseService {
  private worker: Worker | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly queue = new PQueue({ concurrency: 1 })
  private idSeq = 0
  private idleReleaseTimer: NodeJS.Timeout | null = null
  /** Set for the duration of {@link terminateThen}'s `after` callback — blocks
   * `ensureWorker` from spawning a replacement while on-disk weights are being
   * deleted right after teardown. */
  private closing = false
  private readonly logger: ReturnType<typeof loggerService.withContext>

  protected constructor(kind: LocalModelKind) {
    super()
    this.logger = loggerService.withContext(`InferenceHost:${kind}`)
  }

  private ensureWorker(): Worker {
    if (this.closing) {
      throw new Error('inference host is shutting down')
    }
    if (this.worker) return this.worker
    // Last line of defense: the settings/KB cards already hide on Intel Mac (see
    // LocalModelDownloadService.getStatus), but this is the spawn point every
    // caller (embed/loadEmbedding/recognize, including the OCR agent tool)
    // funnels through, so anything that reaches it programmatically fails fast
    // instead of loading a worker that will crash on the missing native binding.
    if (isDarwinX64) {
      throw new Error(
        'Local model inference is not supported on Intel Mac (darwin x64) — onnxruntime-node ships no darwin-x64 binding.'
      )
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
      // A non-zero exit is an abnormal crash (native onnxruntime fault, OOM kill). Log it
      // unconditionally — failAll's no-op-when-idle guard below would otherwise swallow the
      // only crash breadcrumb when nothing is pending, leaving the auto-respawn invisible.
      if (code !== 0) this.logger.error('inference worker exited abnormally', new Error(`exit code ${code}`))
      // A clean (code 0) exit with requests still in flight would otherwise hang their
      // promises forever. failAll no-ops when nothing is pending (the normal terminate()
      // path), so this never double-reports.
      this.failAll(new Error(`inference worker exited unexpectedly (code ${code})`))
    })
    worker.postMessage({
      type: 'init',
      cacheDir: application.getPath('feature.embedding.models'),
      appPath: application.getPath('app.root'),
      onnxRuntimeBindingPath: onnxRuntimeBinaryService.bindingPath()
    })
    this.worker = worker
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
      case 'progress':
        this.pending.get(msg.id)?.onProgress?.({
          status: msg.status,
          file: msg.file,
          loaded: msg.loaded,
          total: msg.total,
          progress: msg.progress
        })
        return
      case 'result': {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        pending.cleanup()
        pending.resolve({ embeddings: msg.embeddings ?? null, text: msg.text ?? null })
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

  protected async send(
    request: DistributiveOmit<InferenceRequest, 'id'>,
    opts: { onProgress?: (p: InferenceProgress) => void; signal?: AbortSignal } = {}
  ): Promise<InferenceResult> {
    // Fail fast on an already-aborted signal rather than occupying a queue slot
    // (sendNow's own check below only fires once this request reaches the front).
    if (opts.signal?.aborted) {
      throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error('aborted')
    }
    this.clearIdleReleaseTimer()
    try {
      const result = await this.queue.add(() => this.sendNow(request, opts))
      if (!result) throw new Error('inference request queue did not return a result')
      return result
    } finally {
      this.scheduleIdleReleaseIfNeeded()
    }
  }

  private sendNow(
    request: DistributiveOmit<InferenceRequest, 'id'>,
    opts: { onProgress?: (p: InferenceProgress) => void; signal?: AbortSignal }
  ): Promise<InferenceResult> {
    const worker = this.ensureWorker()
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
      this.pending.set(id, { resolve, reject, onProgress: opts.onProgress, cleanup })
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
    if (!this.worker) return
    const worker = this.worker
    this.worker = null
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

@Injectable('EmbeddingInferenceHost')
@ServicePhase(Phase.WhenReady)
export class EmbeddingInferenceHost extends InferenceHostBase {
  constructor() {
    super('embedding')
  }

  /** Embed texts off the main thread; loads the model first if it is not cached. */
  async embed(
    texts: string[],
    source: InferenceModelSource,
    modelRepo: string,
    dtype: string,
    signal?: AbortSignal
  ): Promise<number[][]> {
    const result = await this.send({ type: 'embedding.embed', modelRepo, dtype, source, texts }, { signal })
    return result.embeddings ?? []
  }

  /** Download/load the embedding model, reporting progress (used by the model card). */
  async loadEmbedding(
    source: InferenceModelSource,
    modelRepo: string,
    dtype: string,
    onProgress?: (p: InferenceProgress) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await this.send({ type: 'embedding.load', modelRepo, dtype, source }, { onProgress, signal })
  }
}

@Injectable('OcrInferenceHost')
@ServicePhase(Phase.WhenReady)
export class OcrInferenceHost extends InferenceHostBase {
  constructor() {
    super('ocr')
  }

  /** OCR an image off the main thread; loads the PaddleOCR model first if not cached. */
  async recognize(modelPaths: OcrModelPaths, imagePath: string, signal?: AbortSignal): Promise<string> {
    const result = await this.send({ type: 'ocr.recognize', modelPaths, imagePath }, { signal })
    return result.text ?? ''
  }
}
