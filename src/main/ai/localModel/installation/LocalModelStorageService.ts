import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'

import {
  artifactEntryPath,
  type ArtifactRegistryId,
  artifactStagingDir,
  installArtifact,
  isArtifactInstalled,
  removeArtifact
} from '../acquisition/tarballArtifact'
import { getSharedArtifact } from '../catalog/catalog'
import {
  type BundleFile,
  currentPlatformKey,
  type InstallState,
  type ModelBundle,
  type SharedArtifactId
} from '../catalog/types'

const logger = loggerService.withContext('LocalModelStorageService')

interface ArtifactInstall {
  controller: AbortController
  listeners: Set<(fraction: number) => void>
  progress: number
  promise: Promise<void>
  start: () => void
  waiters: number
}

/**
 * What is installed right now, and the gatekeeper for installing or deleting shared
 * artifacts. The catalog says what *can* exist; this says what *does*.
 *
 * State is read from disk on demand rather than cached or persisted: a status query is a
 * handful of `existsSync` calls, while a stored flag would need invalidating every time a
 * user clears a directory behind the app's back — and "the database says installed, the
 * disk disagrees" is a worse failure than a scan.
 */
export class LocalModelStorageService {
  /** One in-flight install per artifact, so an embedding and an OCR download racing for
   * the same runtime await a single fetch instead of both writing the same files. */
  private readonly artifactInstalls = new Map<SharedArtifactId, ArtifactInstall>()
  private readonly artifactReservations = new Map<SharedArtifactId, number>()
  private readonly artifactRemovals = new Map<SharedArtifactId, Promise<void>>()
  private readonly artifactLifecycleGate = new KeyedMutex()

  /** The bundle's own root — what removal deletes. Wider than the model directory when
   * a loader dictates a nested layout, so no empty parent chain is left behind. */
  bundleRootDir(bundle: ModelBundle): string {
    return application.getPath(bundle.installDirKey)
  }

  /** Where the bundle's files belong: the directory loaders are pointed at. */
  bundleInstallDir(bundle: ModelBundle): string {
    return path.join(this.bundleRootDir(bundle), bundle.installSubdir ?? '')
  }

  private bundleFilePath(bundle: ModelBundle, file: BundleFile, dir = this.bundleInstallDir(bundle)): string {
    return path.join(dir, file.relPath)
  }

  private missingFilesIn(bundle: ModelBundle, dir: string): BundleFile[] {
    return bundle.files.filter((file) => {
      const stat = fs.statSync(this.bundleFilePath(bundle, file, dir), { throwIfNoEntry: false })
      return !stat?.isFile() || stat.size < file.minBytes
    })
  }

  /** The files a download still has to fetch. Everything already on disk is left alone, so
   * repairing a half-finished install — or one missing only its shared runtime — does not
   * re-fetch hundreds of MB that are already there. */
  pendingBundleFiles(bundle: ModelBundle): BundleFile[] {
    if (this.resolveInstalledDir(bundle)) return []
    return this.missingFilesIn(bundle, this.bundleInstallDir(bundle))
  }

  /**
   * Bundle files present on disk, ignoring shared artifacts — callers compose the two,
   * because a bundle whose weights are complete but whose runtime is missing is an offer
   * to download ~40MB, not a broken install.
   *
   * Checks size as well as existence: a zero-byte file left by a killed pre-checksum
   * download otherwise reads as a complete model and fails at load time instead.
   */
  scanBundleFiles(bundle: ModelBundle): InstallState {
    if (this.resolveInstalledDir(bundle)) return { status: 'installed' }

    const missing = this.missingFilesIn(bundle, this.bundleInstallDir(bundle))
    if (missing.length === bundle.files.length) return { status: 'not_installed' }
    return { status: 'incomplete', missingFiles: missing.map((file) => file.relPath) }
  }

  /**
   * The directory holding a complete copy of the bundle, or null when none does. Prefers
   * the current layout and falls back to {@link ModelBundle.legacyInstallSubdir}, so an
   * install written by an earlier release keeps working instead of being re-downloaded.
   *
   * Finding only the legacy copy also triggers a one-shot attempt to lift it into place.
   * That attempt is best-effort by design: the files may be held open by a live inference
   * process, and the fallback — keep loading them where they are — costs nothing.
   */
  resolveInstalledDir(bundle: ModelBundle): string | null {
    const installDir = this.bundleInstallDir(bundle)
    if (this.missingFilesIn(bundle, installDir).length === 0) return installDir

    if (!bundle.legacyInstallSubdir) return null
    const legacyDir = path.join(this.bundleRootDir(bundle), bundle.legacyInstallSubdir)
    if (this.missingFilesIn(bundle, legacyDir).length > 0) return null

    this.liftLegacyInstall(bundle, legacyDir, installDir)
    // Re-read both layouts rather than trust the attempt's own verdict, so a directory
    // that lost files to a lift whose rollback also failed can never be handed out.
    if (this.missingFilesIn(bundle, installDir).length === 0) return installDir
    return this.missingFilesIn(bundle, legacyDir).length === 0 ? legacyDir : null
  }

  /** Move a legacy-layout install into the current one, or leave it exactly as it was.
   * Best-effort — a live process can hold the files open — but never half-done: whatever
   * already moved is put back, because an install split across both layouts leaves
   * neither complete and re-downloads a model that is entirely on disk. */
  private liftLegacyInstall(bundle: ModelBundle, legacyDir: string, installDir: string): void {
    const moved: Array<{ from: string; to: string }> = []
    try {
      for (const file of bundle.files) {
        const from = this.bundleFilePath(bundle, file, legacyDir)
        const to = this.bundleFilePath(bundle, file, installDir)
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.renameSync(from, to)
        moved.push({ from, to })
      }
    } catch (error) {
      logger.warn('could not lift a legacy local model install; using it in place', {
        bundle: bundle.id,
        error: String(error)
      })
      for (const { from, to } of moved) {
        try {
          fs.renameSync(to, from)
        } catch (rollbackError) {
          logger.error('could not restore a legacy local model file after a failed lift', {
            bundle: bundle.id,
            file: to,
            error: String(rollbackError)
          })
        }
      }
      return
    }

    // The emptied directory is cosmetic; failing to remove it must not undo a lift that
    // otherwise landed.
    try {
      fs.rmSync(legacyDir, { recursive: true, force: true })
    } catch (error) {
      logger.warn('lifted a legacy local model install but could not remove the old directory', {
        bundle: bundle.id,
        error: String(error)
      })
    }
    logger.info('lifted a legacy local model install into the current layout', { bundle: bundle.id })
  }

  isArtifactReady(id: SharedArtifactId): boolean {
    return isArtifactInstalled(getSharedArtifact(id))
  }

  /**
   * Delete the partials a download that never finished left behind: `<file>.tmp-<uuid>`
   * beside each bundle file, and the staging directory of every shared runtime the bundle
   * needs. A quit, crash or kill ends the writer before it can unlink its own tmp file,
   * and every retry writes a fresh uuid, so without this sweep the leftovers accumulate.
   * Startup only — while a download runs, its tmp file belongs to the writer.
   */
  async sweepStaleDownloads(bundle: ModelBundle): Promise<void> {
    const installDir = this.bundleInstallDir(bundle)
    for (const file of bundle.files) {
      const target = this.bundleFilePath(bundle, file, installDir)
      const dir = path.dirname(target)
      const prefix = `${path.basename(target)}.tmp-`
      let entries: string[]
      try {
        entries = await fs.promises.readdir(dir)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      for (const entry of entries) {
        if (entry.startsWith(prefix)) await fs.promises.rm(path.join(dir, entry), { force: true })
      }
    }
    for (const id of new Set(bundle.requires)) {
      await fs.promises.rm(artifactStagingDir(getSharedArtifact(id)), { recursive: true, force: true })
    }
  }

  isArtifactSupported(id: SharedArtifactId): boolean {
    return getSharedArtifact(id).platforms[currentPlatformKey()] !== undefined
  }

  isBundleSupported(bundle: ModelBundle): boolean {
    return bundle.requires.every((id) => this.isArtifactSupported(id))
  }

  /** Absolute path to the artifact's loadable entry file (see {@link artifactEntryPath}). */
  artifactPath(id: SharedArtifactId): string {
    return artifactEntryPath(getSharedArtifact(id))
  }

  /** Idempotent: returns immediately when already installed, and concurrent callers share
   * the one download. */
  async ensureArtifact(
    id: SharedArtifactId,
    signal: AbortSignal,
    onProgress: ((fraction: number) => void) | undefined,
    registryOrder: readonly [ArtifactRegistryId, ...ArtifactRegistryId[]]
  ): Promise<void> {
    for (;;) {
      if (signal.aborted) throw this.abortError(signal)
      const admission = await this.artifactLifecycleGate.runExclusive(id, () => {
        if (signal.aborted) return { kind: 'aborted' as const }
        const removal = this.artifactRemovals.get(id)
        if (removal) return { kind: 'removing' as const, removal }
        if (this.isArtifactReady(id)) return { kind: 'ready' as const }

        let install = this.artifactInstalls.get(id)
        if (install?.controller.signal.aborted) return { kind: 'draining' as const, install }
        if (!install) {
          install = this.createArtifactInstall(id, registryOrder)
          this.artifactInstalls.set(id, install)
        }
        return { kind: 'installing' as const, install }
      })

      switch (admission.kind) {
        case 'aborted':
          throw this.abortError(signal)
        case 'ready':
          return
        case 'removing':
          try {
            await this.awaitWithAbort(admission.removal, signal)
          } catch (error) {
            if (signal.aborted) throw error
          }
          break
        case 'draining':
          try {
            await this.awaitArtifactInstall(admission.install, signal)
          } catch (error) {
            if (signal.aborted) throw error
          }
          break
        case 'installing':
          admission.install.start()
          return this.awaitArtifactInstall(admission.install, signal, onProgress)
      }
    }
  }

  async reserveArtifacts(ids: readonly SharedArtifactId[], signal: AbortSignal): Promise<() => void> {
    const acquired: SharedArtifactId[] = []
    try {
      for (const id of new Set(ids)) {
        for (;;) {
          if (signal.aborted) throw this.abortError(signal)
          const admission = await this.artifactLifecycleGate.runExclusive(id, () => {
            if (signal.aborted) return { kind: 'aborted' as const }
            const removal = this.artifactRemovals.get(id)
            if (removal) return { kind: 'removing' as const, removal }

            this.artifactReservations.set(id, (this.artifactReservations.get(id) ?? 0) + 1)
            return { kind: 'acquired' as const }
          })
          switch (admission.kind) {
            case 'aborted':
              throw this.abortError(signal)
            case 'acquired':
              acquired.push(id)
              break
            case 'removing':
              try {
                await this.awaitWithAbort(admission.removal, signal)
              } catch (error) {
                if (signal.aborted) throw error
              }
              continue
          }
          break
        }
      }
    } catch (error) {
      this.releaseArtifactReservations(acquired)
      throw error
    }

    let released = false
    return () => {
      if (released) return
      released = true
      this.releaseArtifactReservations(acquired)
    }
  }

  /** Removes an artifact only after atomically excluding new users. */
  async removeArtifactIfUnused(id: SharedArtifactId): Promise<boolean> {
    const admission = await this.artifactLifecycleGate.runExclusive(id, () => {
      if ((this.artifactReservations.get(id) ?? 0) > 0) return { kind: 'reserved' as const }

      const existing = this.artifactRemovals.get(id)
      if (existing) return { kind: 'removing' as const, removal: existing }

      let start!: () => void
      let started = false
      const operation = new Promise<void>((resolve, reject) => {
        start = () => {
          if (started) return
          started = true
          void this.performArtifactRemoval(id).then(resolve, reject)
        }
      })
      const removal = operation.finally(() => {
        if (this.artifactRemovals.get(id) === removal) this.artifactRemovals.delete(id)
      })
      this.artifactRemovals.set(id, removal)
      return { kind: 'removing' as const, removal, start }
    })
    if (admission.kind === 'reserved') return false

    admission.start?.()
    await admission.removal
    return true
  }

  private createArtifactInstall(
    id: SharedArtifactId,
    registryOrder: readonly [ArtifactRegistryId, ...ArtifactRegistryId[]]
  ): ArtifactInstall {
    const controller = new AbortController()
    const install: ArtifactInstall = {
      controller,
      listeners: new Set(),
      progress: 0,
      promise: Promise.resolve(),
      start: () => {},
      waiters: 0
    }
    let resolveInstall!: () => void
    let rejectInstall!: (error: unknown) => void
    const operation = new Promise<void>((resolve, reject) => {
      resolveInstall = resolve
      rejectInstall = reject
    })
    install.promise = operation.finally(() => {
      if (this.artifactInstalls.get(id) === install) this.artifactInstalls.delete(id)
    })
    let started = false
    install.start = () => {
      if (started) return
      started = true
      void installArtifact(
        getSharedArtifact(id),
        controller.signal,
        (fraction) => {
          install.progress = fraction
          for (const listener of install.listeners) listener(fraction)
        },
        registryOrder
      ).then(resolveInstall, rejectInstall)
    }
    return install
  }

  private awaitArtifactInstall(
    install: ArtifactInstall,
    signal: AbortSignal,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    if (signal.aborted) return this.abandonArtifactInstall(install, signal)

    const listener = onProgress ? (fraction: number) => onProgress(fraction) : undefined
    install.waiters += 1
    if (listener) {
      install.listeners.add(listener)
      if (install.progress > 0) listener(install.progress)
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        if (settled) return
        settled = true
        install.waiters -= 1
        if (listener) install.listeners.delete(listener)
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        this.abandonArtifactInstall(install, signal).catch(reject)
      }

      signal.addEventListener('abort', onAbort, { once: true })
      install.promise.then(
        () => {
          cleanup()
          resolve()
        },
        (error) => {
          cleanup()
          reject(error)
        }
      )
    })
  }

  /** The last waiter to leave aborts the install and waits for it to drain, so a cancel
   * does not return while the staging directory is still being written or removed. */
  private async abandonArtifactInstall(install: ArtifactInstall, signal: AbortSignal): Promise<never> {
    if (install.waiters === 0) {
      install.controller.abort(this.abortError(signal))
      await install.promise.catch(() => {})
    }
    throw this.abortError(signal)
  }

  private abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error('aborted')
  }

  private releaseArtifactReservations(ids: readonly SharedArtifactId[]): void {
    for (const id of ids) {
      const remaining = (this.artifactReservations.get(id) ?? 1) - 1
      if (remaining === 0) this.artifactReservations.delete(id)
      else this.artifactReservations.set(id, remaining)
    }
  }

  private async performArtifactRemoval(id: SharedArtifactId): Promise<void> {
    const install = this.artifactInstalls.get(id)
    if (install) {
      install.controller.abort(new Error('shared artifact removed'))
      await install.promise.catch(() => {})
    }
    await removeArtifact(getSharedArtifact(id))
  }

  private awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(this.abortError(signal))

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        cleanup()
        reject(this.abortError(signal))
      }
      const cleanup = () => signal.removeEventListener('abort', onAbort)

      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (value) => {
          cleanup()
          resolve(value)
        },
        (error) => {
          cleanup()
          reject(error)
        }
      )
    })
  }
}

export const localModelStorageService = new LocalModelStorageService()
