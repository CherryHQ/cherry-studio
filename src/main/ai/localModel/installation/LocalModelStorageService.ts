import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'

import { artifactEntryPath, installArtifact, isArtifactInstalled, removeArtifact } from '../acquisition/tarballArtifact'
import { getSharedArtifact } from '../catalog/catalog'
import {
  type BundleFile,
  currentPlatformKey,
  type InstallState,
  type ModelBundle,
  type SharedArtifactId
} from '../catalog/types'

const logger = loggerService.withContext('LocalModelStorageService')

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
  private readonly artifactInstalls = new Map<SharedArtifactId, Promise<void>>()

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
   * worker, and the fallback — keep loading them where they are — costs nothing.
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
   * Best-effort — a live worker can hold the files open — but never half-done: whatever
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
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    if (this.isArtifactReady(id)) return
    const pending = this.artifactInstalls.get(id)
    if (pending) return pending

    const install = installArtifact(getSharedArtifact(id), signal, onProgress).finally(() => {
      this.artifactInstalls.delete(id)
    })
    this.artifactInstalls.set(id, install)
    return install
  }

  /** Deletes a shared artifact outright. Callers decide *whether* it is still needed —
   * see the removal flow in `docs/references/ai/local-models.md`. */
  async removeArtifact(id: SharedArtifactId): Promise<void> {
    await removeArtifact(getSharedArtifact(id))
  }
}

export const localModelStorageService = new LocalModelStorageService()
