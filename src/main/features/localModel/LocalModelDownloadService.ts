import { application } from '@application'
import { loggerService } from '@logger'
import type { LocalModelKind, LocalModelStatus } from '@shared/data/presets/localModel'

const logger = loggerService.withContext('LocalModelDownloadService')

/** Progress / terminal-state payload broadcast to the renderer download cards. */
export interface LocalModelDownloadProgress {
  status: string
  percent: number
  loaded?: number
  total?: number
  file?: string
}

/**
 * Shared on-disk download lifecycle for the local models (embedding + OCR): the
 * downloading/abort state machine, the status probe wiring, the renderer
 * progress broadcast, and cancellation. Subclasses own the model-specific
 * readiness probe, the actual download work (including its own terminal `ready`
 * broadcast), removal, and any post-failure cleanup. Stateless across restarts —
 * the source of truth is the files on disk, not memory.
 */
export abstract class LocalModelDownloadService {
  protected downloading = false
  protected abortController: AbortController | null = null

  /** Tags broadcasts + error logs; selects which renderer card this drives. */
  protected abstract readonly kind: LocalModelKind

  /** Whether the model's files are fully present on disk. */
  protected abstract isReady(): boolean

  /** Download the model; must broadcast its own terminal `ready` on success. */
  protected abstract performDownload(signal: AbortSignal): Promise<void>

  /** Delete the model from disk. Returns whether it was actually removed. */
  abstract remove(): Promise<{ removed: boolean }>

  /** Best-effort cleanup after a failed download (e.g. drop partials). */
  protected cleanupAfterError(): Promise<void> {
    return Promise.resolve()
  }

  getStatus(): LocalModelStatus {
    if (this.downloading) return 'downloading'
    return this.isReady() ? 'ready' : 'not_downloaded'
  }

  async download(): Promise<void> {
    if (this.downloading) return
    this.downloading = true
    this.abortController = new AbortController()
    try {
      await this.performDownload(this.abortController.signal)
    } catch (error) {
      logger.error(`local ${this.kind} model download failed`, error as Error)
      await this.cleanupAfterError()
      this.broadcast({ status: 'error', percent: 0 })
      throw error
    } finally {
      this.downloading = false
      this.abortController = null
    }
  }

  cancel(): void {
    this.abortController?.abort(new Error('download cancelled'))
  }

  protected broadcast(payload: LocalModelDownloadProgress): void {
    application.get('IpcApiService').broadcast('local_model.download_progress', { model: this.kind, ...payload })
  }
}
