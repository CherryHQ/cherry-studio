import fs from 'node:fs'

import { loggerService } from '@logger'
import type {
  LocalModelDownloadResult,
  LocalModelErrorCode,
  LocalModelStatus,
  LocalModelStatusSnapshot
} from '@shared/data/presets/localModel'

import { downloadBundleFiles } from '../acquisition/bundleDownload'
import { type DownloadSourcePreference, type ModelSourceId, modelSourceOrder } from '../acquisition/modelSource'
import { type ArtifactRegistryId, artifactRegistryOrder } from '../acquisition/tarballArtifact'
import type { ModelBundle } from '../catalog/types'
import { localModelStorageService } from './LocalModelStorageService'

const logger = loggerService.withContext('BundleInstaller')

export type ResolveDownloadSourcePreference = () => Promise<DownloadSourcePreference>
export type PublishLocalModelStatus = (snapshot: LocalModelStatusSnapshot) => void

interface DownloadAttempt {
  controller: AbortController
  phase: 'active' | 'draining'
  percent: number
  promise: Promise<LocalModelDownloadResult>
}

type DownloadOutcome =
  | { kind: 'result'; result: LocalModelDownloadResult; terminal: LocalModelStatusSnapshot }
  | { kind: 'error'; error: unknown; terminal: LocalModelStatusSnapshot }

/**
 * What a capability contributes to installing and removing its own bundle. Everything
 * here is a question only the capability can answer — the installer owns the rest.
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
export class BundleInstaller {
  private attempt: DownloadAttempt | null = null
  private removalInFlight: Promise<{ removed: boolean }> | null = null
  private lastDownloadFailed = false
  private incompleteLogged = false

  constructor(
    private readonly bundle: ModelBundle,
    private readonly hooks: CapabilityHooks,
    private readonly publishStatus: PublishLocalModelStatus,
    private readonly finalizeSharedArtifacts: () => Promise<void>
  ) {}

  getStatus(): LocalModelStatus {
    return this.getStatusInfo().status
  }

  getStatusSnapshot(): LocalModelStatusSnapshot {
    const info = this.getStatusInfo()
    const percent = info.status === 'ready' ? 100 : (this.attempt?.percent ?? 0)
    return { ...info, percent }
  }

  /** {@link getStatus} plus why an `error` status arose, for the cards' notice text. */
  getStatusInfo(): { status: LocalModelStatus; errorCode?: LocalModelErrorCode } {
    if (!localModelStorageService.isBundleSupported(this.bundle)) return { status: 'unsupported' }
    if (this.attempt) return { status: 'downloading' }
    if (this.lastDownloadFailed) return { status: 'error', errorCode: 'download_failed' }

    const state = localModelStorageService.scanBundleFiles(this.bundle)
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
    return this.bundle.requires.every((id) => localModelStorageService.isArtifactReady(id))
  }

  private isDurablyReady(): boolean {
    return localModelStorageService.scanBundleFiles(this.bundle).status === 'installed' && this.artifactsReady()
  }

  async download(resolvePreference: ResolveDownloadSourcePreference): Promise<LocalModelDownloadResult> {
    if (this.removalInFlight) throw new Error(`Local model bundle ${this.bundle.id} is being removed.`)
    if (!localModelStorageService.isBundleSupported(this.bundle)) {
      throw new Error(`Local ${this.bundle.capability} model download is not supported on this platform.`)
    }
    const active = this.attempt
    if (active) {
      if (active.phase === 'active') return active.promise
      await active.promise.catch(() => {})
      return this.download(resolvePreference)
    }

    this.lastDownloadFailed = false
    const controller = new AbortController()
    const promise = Promise.resolve().then(() => this.runDownloadAttempt(controller, resolvePreference))
    this.attempt = { controller, phase: 'active', percent: 0, promise }
    this.publishStatus({ status: 'downloading', percent: 0 })
    return promise
  }

  private async runDownloadAttempt(
    controller: AbortController,
    resolvePreference: ResolveDownloadSourcePreference
  ): Promise<LocalModelDownloadResult> {
    const { signal } = controller
    let releaseReservations: (() => void) | undefined
    let outcome: DownloadOutcome
    let failure: { error: unknown } | null = null

    try {
      releaseReservations = await localModelStorageService.reserveArtifacts(this.bundle.requires, signal)
      const preference = await this.waitForSourcePreference(resolvePreference, signal)
      signal.throwIfAborted()
      await this.performDownload(signal, modelSourceOrder(preference), artifactRegistryOrder(preference))
    } catch (error) {
      failure = { error }
    }

    let durableReady = false
    try {
      durableReady = this.isDurablyReady()
    } catch (error) {
      failure ??= { error }
    }

    if (durableReady) {
      outcome = { kind: 'result', result: 'ready', terminal: { status: 'ready', percent: 100 } }
    } else if (signal.aborted) {
      outcome = {
        kind: 'result',
        result: 'cancelled',
        terminal: { status: 'not_downloaded', percent: 0 }
      }
    } else {
      const error = failure?.error ?? new Error(`Local model bundle ${this.bundle.id} is incomplete after download.`)
      logger.error(`local ${this.bundle.capability} model download failed`, error as Error)
      outcome = {
        kind: 'error',
        error,
        terminal: { status: 'error', percent: 0, errorCode: 'download_failed' }
      }
    }

    if (this.attempt?.controller === controller) this.attempt.phase = 'draining'
    releaseReservations?.()
    this.lastDownloadFailed = outcome.kind === 'error'
    if (outcome.kind === 'error' || outcome.result === 'cancelled') {
      await this.runSharedArtifactFinalizer()
    }

    if (this.attempt?.controller === controller) this.attempt = null
    this.publishStatus(outcome.terminal)
    if (outcome.kind === 'error') throw outcome.error
    return outcome.result
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
  private async performDownload(
    signal: AbortSignal,
    sourceOrder: readonly [ModelSourceId, ...ModelSourceId[]],
    registryOrder: readonly [ArtifactRegistryId, ...ArtifactRegistryId[]]
  ): Promise<void> {
    const pending = localModelStorageService.pendingBundleFiles(this.bundle)
    const artifactWeight = this.bundle.requires.reduce(
      (sum, id) => sum + (localModelStorageService.isArtifactReady(id) ? 0 : SHARED_ARTIFACT_WEIGHT),
      0
    )
    const filesWeight = pending.reduce((sum, file) => sum + file.weight, 0)
    const totalWeight = artifactWeight + filesWeight || 1
    let doneWeight = 0

    const report = (fraction: number) => {
      const percent = Math.round((100 * fraction) / totalWeight)
      if (this.attempt?.controller.signal === signal) this.attempt.percent = percent
      this.publishStatus({ status: 'downloading', percent })
    }

    for (const id of this.bundle.requires) {
      if (localModelStorageService.isArtifactReady(id)) continue
      signal.throwIfAborted()
      const base = doneWeight
      await localModelStorageService.ensureArtifact(
        id,
        signal,
        (fraction) => report(base + SHARED_ARTIFACT_WEIGHT * fraction),
        registryOrder
      )
      doneWeight += SHARED_ARTIFACT_WEIGHT
      report(doneWeight)
    }

    if (pending.length > 0) {
      signal.throwIfAborted()
      const base = doneWeight
      await downloadBundleFiles(this.bundle, pending, {
        signal,
        installDir: localModelStorageService.bundleInstallDir(this.bundle),
        sourceOrder,
        onProgress: (fraction) => report(base + filesWeight * fraction)
      })
    }
  }

  async cancel(): Promise<void> {
    const attempt = this.attempt
    if (!attempt) return
    if (attempt.phase === 'active') {
      attempt.phase = 'draining'
      attempt.controller.abort(new Error('download cancelled'))
    }
    await attempt.promise.catch(() => {})
  }

  private waitForSourcePreference(
    resolvePreference: ResolveDownloadSourcePreference,
    signal: AbortSignal
  ): Promise<DownloadSourcePreference> {
    if (signal.aborted) return Promise.reject(this.abortError(signal))

    return new Promise<DownloadSourcePreference>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        callback()
      }
      const onAbort = () => finish(() => reject(this.abortError(signal)))

      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve()
        .then(resolvePreference)
        .then(
          (preference) => finish(() => resolve(preference)),
          (error) => finish(() => reject(error))
        )
    })
  }

  private abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error('aborted')
  }

  private async runSharedArtifactFinalizer(): Promise<void> {
    try {
      await this.finalizeSharedArtifacts()
    } catch (error) {
      logger.warn('failed to clean up shared artifacts for a local model bundle', {
        bundle: this.bundle.id,
        error: String(error)
      })
    }
  }

  /**
   * Delete the bundle's files. Returns whether they were actually removed — a capability
   * may refuse while the model is still in use.
   */
  async remove(): Promise<{ removed: boolean }> {
    if (this.removalInFlight) return this.removalInFlight
    this.removalInFlight = this.performRemove().finally(() => {
      this.removalInFlight = null
    })
    return this.removalInFlight
  }

  private async performRemove(): Promise<{ removed: boolean }> {
    const releaseGuard = this.hooks.acquireRemovalGuard?.()
    if (this.hooks.acquireRemovalGuard && !releaseGuard) {
      logger.info('skipped local model removal because it is in use or already being removed', {
        bundle: this.bundle.id
      })
      return { removed: false }
    }

    try {
      await this.cancel()
      const root = localModelStorageService.bundleRootDir(this.bundle)
      await this.hooks.terminateRuntimeThen(() => fs.promises.rm(root, { recursive: true, force: true }))
      await this.hooks.afterRemove?.()
      await this.runSharedArtifactFinalizer()
      this.publishStatus({ status: 'not_downloaded', percent: 0 })
      return { removed: true }
    } finally {
      releaseGuard?.()
    }
  }
}

/**
 * Progress share of one shared runtime, against the bundle files' own weights (≈ MB).
 * The onnxruntime tarball is tens of MB, so it reads as a comparable slice rather than
 * a bar that jumps.
 */
const SHARED_ARTIFACT_WEIGHT = 20
