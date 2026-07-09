import { application } from '@application'
import { loggerService } from '@logger'
import { isDarwinX64 } from '@main/core/platform'
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
  /** The single active download; concurrent callers await this same promise. */
  private inFlight: Promise<void> | null = null

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

  /**
   * Run {@link cleanupAfterError} without letting it hijack the failure path: a
   * throwing cleanup (e.g. a Windows-locked weight file the `rm` can't remove) must
   * not mask the real download error or skip the `status: 'error'` broadcast that
   * gives the card a terminal state.
   */
  private async safeCleanupAfterError(): Promise<void> {
    try {
      await this.cleanupAfterError()
    } catch (cleanupError) {
      logger.warn(`local ${this.kind} model cleanup after error failed`, cleanupError as Error)
    }
  }

  getStatus(): LocalModelStatus {
    // Unconditional on Intel Mac — the cards hide instead of offering a
    // download that would fail once it reaches the inference worker.
    if (isDarwinX64) return 'unsupported'
    if (this.downloading) return 'downloading'
    return this.isReady() ? 'ready' : 'not_downloaded'
  }

  async download(): Promise<void> {
    // Guard here too, not just in getStatus(): the settings/KB cards hide on
    // Intel Mac, but OCR's performDownload is a plain file fetch that never
    // touches the inference worker, so without this it would happily write
    // unusable weights to disk (and even get promoted as the default OCR
    // engine) for any caller that reaches `download()` directly.
    if (isDarwinX64) {
      throw new Error(`Local ${this.kind} model download is not supported on Intel Mac (darwin x64).`)
    }
    // Coalesce concurrent callers — the settings card and the KB download entry
    // hit the same main-process singleton. Both await the SAME in-flight download,
    // so neither resolves (→ reports ready / runs post-download work like the KB
    // entry's select()) until it genuinely completes, past the subclass's own
    // registration + terminal `ready` broadcast.
    if (this.inFlight) return this.inFlight
    this.downloading = true
    this.abortController = new AbortController()
    const { signal } = this.abortController
    this.inFlight = (async () => {
      try {
        await this.performDownload(signal)
      } catch (error) {
        if (signal.aborted) {
          // User-initiated cancel — not a failure. Drop partials, but stay quiet:
          // no error log and no `status: 'error'` broadcast (the cards render that
          // as "download failed"). Still rethrow so awaiting callers unwind.
          await this.safeCleanupAfterError()
          throw error
        }
        logger.error(`local ${this.kind} model download failed`, error as Error)
        await this.safeCleanupAfterError()
        this.broadcast({ status: 'error', percent: 0 })
        throw error
      } finally {
        this.downloading = false
        this.abortController = null
        this.inFlight = null
      }
    })()
    return this.inFlight
  }

  cancel(): void {
    this.abortController?.abort(new Error('download cancelled'))
  }

  protected broadcast(payload: LocalModelDownloadProgress): void {
    application.get('IpcApiService').broadcast('local_model.download_progress', { model: this.kind, ...payload })
  }
}
