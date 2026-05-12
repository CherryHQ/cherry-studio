/**
 * VfsBlobService — owns the temp directory chef writes truncated tool
 * results into, and runs a startup stale-file sweep.
 *
 * Why FS instead of SQLite: VFS blobs are short-lived, opaque, large
 * tool outputs. They're queried by absolute path only (chef's
 * `FileSystemAdapter.getPhysicalPath` exposes the path in the
 * `<persisted-output>` marker), never indexed, rarely read more than
 * once. Putting them in the main DB caused bloat with no query benefit.
 * macOS/Linux clean `app.temp`-style locations on a periodic schedule;
 * the boot-time sweep here is for Windows where they don't.
 *
 * Responsibilities:
 * - Own one shared `FileSystemAdapter` pointed at
 *   `application.getPath('feature.context_chef.vfs')`. Wired into
 *   chef middleware via `truncate.storage` in the contextChef feature.
 * - The model retrieves the full content by calling `fs__read` with
 *   the absolute path that chef writes into the marker — there is NO
 *   IPC channel and NO custom retrieval tool here. fs__read auto-allows
 *   any absolute path (including paths under this directory).
 * - Run a stale-file sweep on startup: anything older than 7 days is
 *   unlinked.
 */

import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { FileSystemAdapter } from '@context-chef/core'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('VfsBlobService')

/** Files older than this are unlinked at startup. 7 days. */
const STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000

@Injectable('VfsBlobService')
@ServicePhase(Phase.BeforeReady)
export class VfsBlobService extends BaseService {
  private rootDir!: string
  private adapter!: FileSystemAdapter

  protected onInit(): void {
    this.rootDir = application.getPath('feature.context_chef.vfs')
    fs.mkdirSync(this.rootDir, { recursive: true })
    this.adapter = new FileSystemAdapter(this.rootDir)
  }

  protected onReady(): void {
    // Best-effort startup cleanup. Don't await — we don't want to block
    // service ready on filesystem walking.
    void this.sweepStale().catch((error) => {
      logger.warn('startup VFS sweep failed', error as Error)
    })
  }

  /**
   * Returns the underlying `FileSystemAdapter` for chef middleware to
   * use as `truncate.storage`. chef's adapter exposes `getPhysicalPath`
   * out of the box — chef's `<persisted-output>` marker therefore
   * advertises an absolute file path the model can `fs__read` directly,
   * no custom URI-aware tool needed.
   */
  getAdapter(): FileSystemAdapter {
    return this.adapter
  }

  /** Absolute path to the VFS storage directory. */
  getRoot(): string {
    return this.rootDir
  }

  /**
   * Boot-time stale-file sweep. Walks the root directory, unlinks any
   * file with mtime older than `STALE_AGE_MS`. macOS/Linux usually
   * already cleaned these; Windows almost never does, so this is the
   * single source of bounded growth on Windows.
   */
  async sweepStale(maxAgeMs: number = STALE_AGE_MS): Promise<{ deleted: number }> {
    const cutoff = Date.now() - maxAgeMs
    let deleted = 0

    let entries: string[]
    try {
      entries = await fs.promises.readdir(this.rootDir)
    } catch (error) {
      // ENOENT etc — directory got removed externally. Recreate and bail.
      logger.warn('vfs root unreadable, recreating', { error: (error as Error).message })
      await fs.promises.mkdir(this.rootDir, { recursive: true })
      return { deleted: 0 }
    }

    for (const entry of entries) {
      const full = path.join(this.rootDir, entry)
      try {
        const stat = await fs.promises.stat(full)
        if (!stat.isFile()) continue
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(full)
          deleted++
        }
      } catch (error) {
        // Best-effort per file; swallow and keep going.
        logger.debug('vfs sweep skip entry', { entry, error: (error as Error).message })
      }
    }

    if (deleted > 0) {
      logger.info('vfs sweep complete', { deleted, maxAgeMs })
    }
    return { deleted }
  }
}
