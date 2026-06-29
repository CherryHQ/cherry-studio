import { Worker } from 'node:worker_threads'

import { application } from '@application'
import { loggerService } from '@logger'

import type { InferenceModelSource, InferenceRequest, InferenceResponse, OcrModelPaths } from './inferenceProtocol'
import { inferenceWorkerSource } from './inferenceWorkerSource'

const logger = loggerService.withContext('InferenceHost')

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
}

/**
 * Owns the single `worker_threads` worker that runs onnxruntime-node inference
 * off the main thread, so embedding/OCR never blocks the Electron event loop.
 *
 * The worker source, the wire protocol, and this class's method signatures are
 * all process-agnostic: moving to an Electron `utilityProcess` (for crash
 * isolation) later touches only the spawn/teardown internals of this file.
 */
class InferenceHost {
  private worker: Worker | null = null
  private readonly pending = new Map<string, Pending>()
  private idSeq = 0

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(inferenceWorkerSource, { eval: true })
    // Inference is opt-in; a loaded 600MB+ model must never keep the app alive on quit.
    worker.unref()
    worker.on('message', (msg: InferenceResponse) => this.handleMessage(msg))
    worker.on('error', (err) => this.failAll(err instanceof Error ? err : new Error(String(err))))
    worker.on('exit', (code) => {
      this.worker = null
      if (code !== 0) this.failAll(new Error(`inference worker exited with code ${code}`))
    })
    worker.postMessage({
      type: 'init',
      cacheDir: application.getPath('feature.embedding.models'),
      appPath: application.getPath('app.root')
    })
    this.worker = worker
    return worker
  }

  private handleMessage(msg: InferenceResponse): void {
    switch (msg.type) {
      case 'log': {
        const log = msg.level === 'warn' ? logger.warn : msg.level === 'error' ? logger.error : logger.info
        log.call(logger, `[worker] ${msg.message}`)
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
        pending.resolve({ embeddings: msg.embeddings ?? null, text: msg.text ?? null })
        return
      }
      case 'error': {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        pending.reject(new Error(msg.message))
        return
      }
    }
  }

  private failAll(err: Error): void {
    logger.error('inference worker failed', err)
    for (const [, pending] of this.pending) pending.reject(err)
    this.pending.clear()
  }

  private send(
    request: DistributiveOmit<InferenceRequest, 'id'>,
    opts: { onProgress?: (p: InferenceProgress) => void; signal?: AbortSignal } = {}
  ): Promise<InferenceResult> {
    const worker = this.ensureWorker()
    const id = String(++this.idSeq)
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(opts.signal.reason instanceof Error ? opts.signal.reason : new Error('aborted'))
        return
      }
      this.pending.set(id, { resolve, reject, onProgress: opts.onProgress })
      opts.signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.has(id)) return
          this.pending.delete(id)
          reject(opts.signal?.reason instanceof Error ? opts.signal.reason : new Error('aborted'))
        },
        { once: true }
      )
      worker.postMessage({ ...request, id } as InferenceRequest)
    })
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

  /** OCR an image off the main thread; loads the PaddleOCR model first if not cached. */
  async recognize(modelPaths: OcrModelPaths, imagePath: string, signal?: AbortSignal): Promise<string> {
    const result = await this.send({ type: 'ocr.recognize', modelPaths, imagePath }, { signal })
    return result.text ?? ''
  }

  /** Kill the worker (cancels any in-flight download and frees the model). */
  terminate(): void {
    if (!this.worker) return
    void this.worker.terminate()
    this.worker = null
    this.failAll(new Error('inference host terminated'))
  }
}

export const inferenceHost = new InferenceHost()
