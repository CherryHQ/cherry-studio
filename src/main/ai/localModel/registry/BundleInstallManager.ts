import fs from 'node:fs'

import { application } from '@application'
import { loggerService } from '@logger'
import { isDarwinX64 } from '@main/core/platform'
import type { LocalModelDownloadResult, LocalModelErrorCode, LocalModelStatus } from '@shared/data/presets/localModel'

import { downloadBundleFiles } from '../acquisition/bundleDownload'
import { localModelRegistry } from './LocalModelRegistry'
import type { ModelBundle } from './types'

const logger = loggerService.withContext('BundleInstallManager')

/** Progress / terminal-state payload broadcast to the renderer download cards. */
export interface LocalModelDownloadProgress {
  status: string
  percent: number
  errorCode?: LocalModelErrorCode
  loaded?: number
  total?: number
  file?: string
}

/**
 * What a capability contributes to installing and removing its own bundle. Everything
 * here is a question only the capability can answer — the manager owns the rest.
 */
export interface CapabilityHooks {
  /**
   * Refuse removal while the model is still referenced (the embedding model backs
   * knowledge bases that cannot be re-indexed without it). Returns a release callback,
   * or undefined to decline.
   */
  acquireRemovalGuard?: () => (() => void) | undefined
  /**
   * Release the inference worker, run `after`, then allow it to respawn. Deleting weights
   * while a worker holds them open fails outright on Windows, and a request queued behind
   * the delete would otherwise respawn a worker onto files that are being removed.
   */
  terminateRuntimeThen: <T>(after: () => Promise<T>) => Promise<T>
  /** Housekeeping once the files are gone — e.g. clearing a preference that points at
   * the model, which would otherwise strand every consumer on an unavailable engine. */
  afterRemove?: () => Promise<void>
}

/**
 * The install lifecycle of one bundle: status, download with progress, cancellation and
 * removal. Generic over the catalog — a new model is a catalog entry plus its hooks, not
 * another copy of this class.
 *
 * Stateless across restarts: only the latest failure is held in memory so the UI can
 * recover during this run. Afterwards the files on disk are the whole truth.
 */
export class BundleInstallManager {
  private downloading = false
  private abortController: AbortController | null = null
  /** The single active download; concurrent callers await the same terminal result. */
  private inFlight: Promise<LocalModelDownloadResult> | null = null
  private lastDownloadFailed = false
  private incompleteLogged = false

  constructor(
    private readonly bundle: ModelBundle,
    private readonly hooks: CapabilityHooks
  ) {}

  getStatus(): LocalModelStatus {
    return this.getStatusInfo().status
  }

  /** {@link getStatus} plus why an `error` status arose, for the cards' notice text. */
  getStatusInfo(): { status: LocalModelStatus; errorCode?: LocalModelErrorCode } {
    // Unconditional on Intel Mac — the cards hide instead of offering a download that
    // would fail once it reaches the inference worker.
    if (isDarwinX64) return { status: 'unsupported' }
    if (this.downloading) return { status: 'downloading' }
    if (this.lastDownloadFailed) return { status: 'error', errorCode: 'download_failed' }

    const state = localModelRegistry.scanBundleFiles(this.bundle)
    switch (state.status) {
      case 'installed':
        // Complete files without the shared runtime read as not-downloaded, not as an
        // error: Download re-fetches only the missing runtime, so the card must offer it
        // rather than a failure the user cannot act on.
        this.incompleteLogged = false
        return this.artifactsReady() ? { status: 'ready' } : { status: 'not_downloaded' }
      case 'incomplete':
        if (!this.incompleteLogged) {
          logger.warn('local model files are incomplete', { bundle: this.bundle.id, missing: state.missingFiles })
          this.incompleteLogged = true
        }
        return { status: 'error', errorCode: 'incomplete_cache' }
      default:
        this.incompleteLogged = false
        return { status: 'not_downloaded' }
    }
  }

  private artifactsReady(): boolean {
    return this.bundle.requires.every((id) => localModelRegistry.isArtifactReady(id))
  }

  async download(): Promise<LocalModelDownloadResult> {
    // Guarded here too, not just in getStatusInfo: the cards hide on Intel Mac, but a
    // caller reaching download() directly would otherwise write unusable files to disk.
    if (isDarwinX64) {
      throw new Error(`Local ${this.bundle.capability} model download is not supported on Intel Mac (darwin x64).`)
    }
    // Coalesce concurrent callers — the settings card and the KB download entry hit the
    // same singleton. Both await the SAME download, so neither resolves (and runs its
    // post-download work) until it genuinely completes.
    if (this.inFlight) return this.inFlight

    this.lastDownloadFailed = false
    this.downloading = true
    this.abortController = new AbortController()
    const { signal } = this.abortController
    this.inFlight = (async () => {
      try {
        await this.performDownload(signal)
        this.broadcast({ status: 'ready', percent: 100 })
        return 'ready'
      } catch (error) {
        if (signal.aborted) {
          // User-initiated cancel — not a failure. Stay quiet: no error log and no
          // `status: 'error'` broadcast, which the cards render as "download failed".
          this.broadcast({ status: 'not_downloaded', percent: 0 })
          return 'cancelled'
        }
        logger.error(`local ${this.bundle.capability} model download failed`, error as Error)
        this.lastDownloadFailed = true
        this.broadcast({ status: 'error', percent: 0, errorCode: 'download_failed' })
        throw error
      } finally {
        this.downloading = false
        this.abortController = null
        this.inFlight = null
      }
    })()
    return this.inFlight
  }

  /**
   * Shared runtimes first, then the bundle's own missing files, on one progress scale.
   * Both phases map onto that single scale — a phase restarting the bar at 0 is what used
   * to make it snap backwards at the boundary.
   *
   * Nothing is deleted on failure: every write goes through a temp file renamed only on
   * completion, so a failed attempt leaves no partials — while the files already on disk
   * may predate this attempt entirely. Wiping them would turn a failed ~40MB runtime fetch
   * into the loss of a complete ~614MB model.
   */
  private async performDownload(signal: AbortSignal): Promise<void> {
    const pending = localModelRegistry.pendingBundleFiles(this.bundle)
    const artifactWeight = this.bundle.requires.reduce(
      (sum, id) => sum + (localModelRegistry.isArtifactReady(id) ? 0 : SHARED_ARTIFACT_WEIGHT),
      0
    )
    const filesWeight = pending.reduce((sum, file) => sum + file.weight, 0)
    const totalWeight = artifactWeight + filesWeight || 1
    let doneWeight = 0

    const report = (fraction: number) => {
      this.broadcast({ status: 'downloading', percent: Math.round((100 * fraction) / totalWeight) })
    }

    for (const id of this.bundle.requires) {
      if (localModelRegistry.isArtifactReady(id)) continue
      const base = doneWeight
      await localModelRegistry.ensureArtifact(id, signal, (fraction) =>
        report(base + SHARED_ARTIFACT_WEIGHT * fraction)
      )
      doneWeight += SHARED_ARTIFACT_WEIGHT
      report(doneWeight)
    }

    if (pending.length > 0) {
      const base = doneWeight
      await downloadBundleFiles(this.bundle, pending, {
        signal,
        installDir: localModelRegistry.bundleInstallDir(this.bundle),
        onProgress: (fraction) => report(base + filesWeight * fraction)
      })
    }
  }

  cancel(): void {
    this.abortController?.abort(new Error('download cancelled'))
  }

  /**
   * Delete the bundle's files. Returns whether they were actually removed — a capability
   * may refuse while the model is still in use.
   */
  async remove(): Promise<{ removed: boolean }> {
    const releaseGuard = this.hooks.acquireRemovalGuard?.()
    if (this.hooks.acquireRemovalGuard && !releaseGuard) {
      logger.info('skipped local model removal because it is in use or already being removed', {
        bundle: this.bundle.id
      })
      return { removed: false }
    }

    try {
      // Reset dependent settings before the files go: a preference still pointing at this
      // model would break every consumer of it, with no self-heal.
      await this.hooks.afterRemove?.()
      const root = localModelRegistry.bundleRootDir(this.bundle)
      await this.hooks.terminateRuntimeThen(() => fs.promises.rm(root, { recursive: true, force: true }))
      return { removed: true }
    } finally {
      releaseGuard?.()
    }
  }

  private broadcast(payload: LocalModelDownloadProgress): void {
    application
      .get('IpcApiService')
      .broadcast('local_model.download_progress', { model: this.bundle.capability, ...payload })
  }
}

/**
 * Progress share of one shared runtime, against the bundle files' own weights (≈ MB).
 * The onnxruntime tarball is tens of MB, so it reads as a comparable slice rather than
 * a bar that jumps.
 */
const SHARED_ARTIFACT_WEIGHT = 20
