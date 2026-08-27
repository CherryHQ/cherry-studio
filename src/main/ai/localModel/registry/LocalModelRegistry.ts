import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'

import { artifactEntryPath, installArtifact, isArtifactInstalled, removeArtifact } from '../acquisition/tarballArtifact'
import { getSharedArtifact } from './catalog'
import type { BundleFile, InstallState, ModelBundle, SharedArtifactId } from './types'

/**
 * What is installed right now, and the gatekeeper for installing or deleting shared
 * artifacts. The catalog says what *can* exist; this says what *does*.
 *
 * State is read from disk on demand rather than cached or persisted: a status query is a
 * handful of `existsSync` calls, while a stored flag would need invalidating every time a
 * user clears a directory behind the app's back — and "the database says installed, the
 * disk disagrees" is a worse failure than a scan.
 */
class LocalModelRegistry {
  /** One in-flight install per artifact, so an embedding and an OCR download racing for
   * the same runtime await a single fetch instead of both writing the same files. */
  private readonly artifactInstalls = new Map<SharedArtifactId, Promise<void>>()

  bundleInstallDir(bundle: ModelBundle): string {
    return application.getPath(bundle.installDirKey)
  }

  private bundleFilePath(bundle: ModelBundle, file: BundleFile): string {
    return path.join(this.bundleInstallDir(bundle), file.relPath)
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
    const missingFiles = bundle.files
      .filter((file) => {
        const stat = fs.statSync(this.bundleFilePath(bundle, file), { throwIfNoEntry: false })
        return !stat?.isFile() || stat.size < file.minBytes
      })
      .map((file) => file.relPath)

    if (missingFiles.length === 0) return { status: 'installed' }
    if (missingFiles.length === bundle.files.length) return { status: 'not_installed' }
    return { status: 'incomplete', missingFiles }
  }

  isArtifactReady(id: SharedArtifactId): boolean {
    return isArtifactInstalled(getSharedArtifact(id))
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

export const localModelRegistry = new LocalModelRegistry()
