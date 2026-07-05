// ExportOrchestrator — produces a .cbu backup archive from the current app state.
//
// Pipeline (export-orchestrator.md §"ExportOrchestrator 5 步流程"):
//   1. resolvePreset → topo-sorted domain set
//   2. copier.copyTo(temp) — online `db.backup()` of live DB → backup.sqlite
//   3. (TODO) beforeArchive per domain on the copy — redaction (no contributor
//      implements it yet; the loop is wired when the first hook lands)
//   4. (TODO) collectFileResources per domain + stage file/knowledge blobs →
//      files/ + knowledge/ in the archive (lands with contributor export hooks)
//   5. build manifest + assemble the .cbu zip
//
// FIRST SLICE: **FULL preset, DB-only archive** (manifest.json + backup.sqlite).
// Only `preset: 'full'` is accepted this slice — a lite archive would require a
// contributor strip step (delete excluded domains' rows from the copy, FK-aware —
// e.g. included `chat_message_file_ref` references excluded `file_entry`) which
// lands with the contributor export hooks. Producing a lite archive without that
// strip would leak excluded-domain rows (data exposure) — so lite is gated off
// rather than shipped broken. File/knowledge blob staging is likewise deferred
// (includeFiles stays false); the file_entry rows a full export carries will get
// their blobs when collectFileResources + staging land.

import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import type { ReadonlyBackupRegistry } from '@main/data/db/backup/contributor-types'

import { assembleArchive } from './archive'
import type { BackupDbCopier } from './BackupDbCopier'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from './manifest'
import { resolvePreset } from './presets'

/** User-facing export options (renderer passes preset; BackupService fills the rest). */
export interface ExportBackupOptions {
  readonly preset: 'full' | 'lite'
  /** Final .cbu output path. */
  readonly outputPath: string
  /**
   * Unique id for this export — used to name the temp copy (`<restoreId>.sqlite`).
   * MUST be a safe basename (no path separators / NUL / `..`); a caller-supplied
   * `../../foo` would otherwise escape the temp dir (path traversal) and let the
   * copier overwrite/delete an arbitrary file. Validated at entry.
   */
  readonly restoreId: string
  /** Producer app version (package.json) — diagnostic only, NOT in the compat gate. */
  readonly producerAppVersion: string
  /** Producer's last applied migration `when` (folderMillis) — the schema-version fingerprint. */
  readonly schemaMigrationId: string
}

/**
 * A safe filename basename — non-empty, no path separators, no NUL, not `.`/`..`.
 * Guards the temp-copy path against caller-controlled `restoreId` path traversal.
 */
const isSafeBasename = (id: string): boolean =>
  id.length > 0 &&
  !id.includes('/') &&
  !id.includes('\\') &&
  !id.includes('\0') &&
  id !== '.' &&
  id !== '..'

export interface ExportBackupResult {
  readonly archivePath: string
  readonly manifest: BackupManifest
}

/** Constructor dependencies (injected for testability). */
export interface ExportOrchestratorDeps {
  /** Copies live DB → a temp backup.sqlite (online db.backup(), see BackupDbCopier). */
  readonly copier: BackupDbCopier
  /** Finalized contributor registry — used for topoSort of the preset's domain set. */
  readonly registry: ReadonlyBackupRegistry
  /** Temp dir for the DB-copy staging; the orchestrator removes the copy after archiving. */
  readonly tempDir: string
}

/**
 * Export orchestrator. Pure class (no lifecycle wiring yet) — BackupService will
 * construct it once createSnapshot/backupTo + the file-staging path are wired; unit
 * tests construct it directly with a stub copier + (real or stub) registry.
 */
export class ExportOrchestrator {
  constructor(private readonly deps: ExportOrchestratorDeps) {}

  async exportBackup(options: ExportBackupOptions): Promise<ExportBackupResult> {
    // Gate: restoreId MUST be a safe basename — it's joined into the temp path, so a
    // caller-supplied '../../foo' would escape feature.backup.temp and let the
    // copier overwrite/delete an arbitrary file (path traversal).
    if (!isSafeBasename(options.restoreId)) {
      throw new Error(
        `ExportOrchestrator: restoreId must be a safe basename (no '/', '\\', NUL, '..', '.') — got ${JSON.stringify(options.restoreId)}`
      )
    }

    // Gate: only 'full' is supported this slice. 'lite' needs a contributor strip
    // step (FK-aware delete of excluded domains' rows from the copy) that lands
    // with the contributor export hooks — without it a lite .cbu would carry
    // excluded-domain rows despite the manifest claiming they're absent (data
    // exposure). See class docstring.
    if (options.preset !== 'full') {
      throw new Error(
        `ExportOrchestrator: preset '${options.preset}' is not supported yet (requires contributor strip step; only 'full' is supported in this slice)`
      )
    }

    const { copier, registry, tempDir } = this.deps

    // 1. preset → topo-sorted domains (consumers rely on dependency order)
    const domains = registry.topoSort(resolvePreset(options.preset))

    // 2. online-copy live DB → temp backup.sqlite
    const backupDbPath = join(tempDir, `${options.restoreId}.sqlite`)
    let manifest: BackupManifest
    try {
      await copier.copyTo(backupDbPath)

      // 3. build manifest — DB-only slice: blobs land with contributor export hooks
      manifest = {
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        preset: options.preset,
        domains,
        includeFiles: false,
        includeKnowledgeFiles: false,
        sensitiveData: { included: true, rotated: false },
        schemaMigrationId: options.schemaMigrationId,
        producerAppVersion: options.producerAppVersion,
        files: { total: 0, totalBytes: 0 },
        knowledge: { bases: [] }
      }

      // 4. assemble the .cbu (manifest.json + backup.sqlite; no files/knowledge yet)
      await assembleArchive(options.outputPath, { manifest, dbCopyPath: backupDbPath })
    } finally {
      // Always remove the temp copy — on success (the archive holds its own byte
      // copy) AND on failure (don't leak a partial copy). Spec "disk-full runtime
      // path" (export-orchestrator.md §磁盘预算) requires temp cleanup.
      await unlink(backupDbPath).catch(() => {})
    }

    return { archivePath: options.outputPath, manifest }
  }
}
