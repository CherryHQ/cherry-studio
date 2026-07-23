/**
 * VfsBlobService — owns the temp directory the context middleware writes
 * truncated tool results into, and runs a startup stale-file sweep.
 *
 * Why FS instead of SQLite: VFS blobs are short-lived, opaque, large
 * tool outputs. They're queried by absolute path only (the adapter's
 * `getPhysicalPath` exposes the path in the `<persisted-output>` marker),
 * never indexed, rarely read more than once. Putting them in the main DB
 * caused bloat with no query benefit. macOS/Linux clean `app.temp`-style
 * locations on a periodic schedule; the boot-time sweep here is for
 * Windows where they don't.
 *
 * On the apparent duplication — the same tool output also lives in the
 * message history (`message.data`). This temp copy is NOT the redundant
 * one: it is content-addressed (the offloader writes `vfs_<sha256>.txt`
 * and skips the write when the file already exists), so a large result
 * re-sent across turns, read back, or duplicated across regenerate/branch
 * siblings is stored once. The redundant copy is the DB one — per-row
 * JSON with no content-addressing, so every message carrying that content
 * is a separate full copy — and trimming *that* (keep a marker, not the
 * megabytes) is tracked in #16786. The middleware offloads through a
 * `(bytes) → path` adapter because it sees the outgoing prompt and not
 * cherry's store, so it can't trim the DB itself — that is cherry's
 * persistence layer's job; this copy is where the model reads it back,
 * transient (OS-reclaimed + swept).
 *
 * Responsibilities:
 * - Own one shared `FileSystemAdapter` pointed at
 *   `application.getPath('feature.context_build.vfs.temp')`. Wired into
 *   the context middleware via `truncate.storage` in the context-build
 *   feature.
 * - There is NO IPC channel here. The absolute path written into the
 *   `<persisted-output>` marker is readable by the model via the
 *   `fs_read` builtin — strict root containment with this directory
 *   as the allowed root; the system prompt teaches the protocol while
 *   fs_read is active.
 * - Run a stale-file sweep on startup: anything older than 7 days is
 *   unlinked.
 */

import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import type { VFSStorageAdapter } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('VfsBlobService')

/** Files older than this are unlinked at startup. 7 days. */
const STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Tray-resident sessions run for weeks — re-sweep daily, not just at boot. */
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Filesystem-backed `VFSStorageAdapter` for the aiCore context middleware.
 *
 * Vendored from @context-chef/core 3.8.0 (MIT, same author) alongside the
 * aiCore context module — it lives here (not in aiCore) because it is the
 * only node:fs-dependent piece, and the main process owns storage.
 * Writes are atomic (tmp file + rename) so `exists()` never reports a
 * partially written content-addressed entry.
 */
export class FileSystemAdapter implements VFSStorageAdapter {
  private storageDir: string

  constructor(storageDir: string) {
    this.storageDir = storageDir
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  write(filename: string, content: string): void {
    const filepath = path.join(this.storageDir, filename)
    const tmppath = path.join(this.storageDir, `.tmp_${process.pid}_${filename}`)
    try {
      fs.writeFileSync(tmppath, content, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // The storage dir can vanish mid-process — OS temp cleaners purge
      // /var/folders & friends on long-running hosts, and the constructor's
      // mkdir only ran once. Recreate and retry once.
      fs.mkdirSync(this.storageDir, { recursive: true })
      fs.writeFileSync(tmppath, content, 'utf8')
    }
    fs.renameSync(tmppath, filepath) // atomic on the same filesystem
  }

  exists(filename: string): boolean {
    return fs.existsSync(path.join(this.storageDir, filename))
  }

  read(filename: string): string | null {
    const filepath = path.join(this.storageDir, filename)
    if (fs.existsSync(filepath)) {
      return fs.readFileSync(filepath, 'utf8')
    }
    return null
  }

  getPhysicalPath(filename: string): string {
    return path.join(this.storageDir, filename)
  }
}

@Injectable('VfsBlobService')
// WhenReady: both consumers resolve the service only during AI requests, which
// are post-ready — the context middleware adapter (buildContextOptions) and fs_read's
// root. Init is a sub-millisecond mkdir + adapter construction and the stale
// sweep is fire-and-forget in onReady, so there is no hard ordering constraint
// that would require BeforeReady.
@ServicePhase(Phase.WhenReady)
export class VfsBlobService extends BaseService {
  private rootDir!: string
  private adapter!: FileSystemAdapter

  protected onInit(): void {
    this.rootDir = application.getPath('feature.context_build.vfs.temp')
    // Redundant with getPath auto-ensure, kept as fail-fast: auto-ensure only
    // warns on failure, while a throw here fails service init loudly.
    fs.mkdirSync(this.rootDir, { recursive: true })
    this.adapter = new FileSystemAdapter(this.rootDir)
  }

  protected onReady(): void {
    // Best-effort startup cleanup. Don't await — we don't want to block
    // service ready on filesystem walking.
    void this.sweepStale().catch((error) => {
      logger.warn('startup VFS sweep failed', error as Error)
    })
    // Re-sweep daily: a boot-only sweep never fires in week-long tray
    // sessions, and the periodic run also self-heals a storage dir removed
    // by the OS temp cleaner mid-session (sweepStale recreates it on
    // ENOENT). registerInterval handles exceptions and unrefs the timer.
    this.registerInterval(async () => {
      await this.sweepStale()
    }, SWEEP_INTERVAL_MS)
  }

  /**
   * Returns the underlying `FileSystemAdapter` for the context middleware
   * to use as `truncate.storage`. The adapter exposes `getPhysicalPath`,
   * so the `<persisted-output>` marker carries an absolute file path the
   * model retrieves via `fs_read` (this directory is its allowed
   * containment root — see `getRoot`).
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
