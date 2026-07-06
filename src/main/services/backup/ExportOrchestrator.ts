// ExportOrchestrator — produces a .cbu backup archive from the current app state.
//
// Pipeline (export-orchestrator.md §"ExportOrchestrator 5 步流程"):
//   1. resolvePreset → topo-sorted domain set
//   2. copier.copyTo(temp) — online `db.backup()` of live DB → backup.sqlite
//   2.5. (lite only) stripper.strip — delete excluded-domain rows + CASCADE-prune
//        junction referrers, so the copy never carries rows the manifest omits
//   3. (TODO) beforeArchive per domain on the copy — redaction (no contributor
//      implements it yet; the loop is wired when the first hook lands)
//   4. collectFileResources per domain + stage file/knowledge blobs →
//      files/ + knowledge/ in the archive
//   5. build manifest + assemble the .cbu zip
//
// SNAPSHOT CONSISTENCY: collect + stage read from a read-only connection to
// backup.sqlite (the point-in-time copy), NOT from the live DB. Without this,
// a row deleted on live between copyTo() and collect would leave backup.sqlite
// referencing a blob that the archive never staged (restore would lose the file).
// Reading from the snapshot guarantees the collected ids + the archived DB agree.
//
// STAGING ISOLATION: blobs stage under `<tempDir>/<restoreId>-stage/` so two
// overlapping exports (or a crashed prior run) can never mix stale blobs into a
// fresh archive or delete another export's staging mid-archive.
//
// CURRENT SLICE: FULL + LITE presets. lite runs step 2.5 (ExcludedDomainStripper
// physically deletes excluded-domain rows + schema CASCADE prunes junction
// referrers) before the readonly snapshot opens. beforeArchive (step 3) stays a
// no-op until the first redaction contributor.

import { rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { loggerService } from '@logger'
import { BackupReadonlyDb, type FileResourceContext } from '@main/data/db/backup/contexts'
import type { ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { ConflictStrategy } from '@main/data/db/backup/domains'
import { ALWAYS_STRIP_PHYSICAL_TABLES } from '@main/data/db/backup/exclusions'
import type { BackupProgressUpdate } from '@shared/types/backup'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { assembleArchive } from './archive'
import type { BackupDbCopier } from './BackupDbCopier'
import { BackupCancelledError } from './errors'
import type { BackupStripper } from './ExcludedDomainStripper'
import { SqliteFileStager } from './FileStager'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from './manifest'
import { LITE_EXCLUDED, resolvePreset } from './presets'

/** User-facing export options (renderer passes preset; BackupService fills the rest). */
export interface ExportBackupOptions {
  readonly preset: 'full' | 'lite'
  /** Final .cbu output path. */
  readonly outputPath: string
  /**
   * Unique id for this export — used to name the temp copy (`<restoreId>.sqlite`)
   * AND the per-export staging root (`<restoreId>-stage/`). MUST be a safe basename
   * (no path separators / NUL / `..`); a caller-supplied `../../foo` would escape
   * the temp dir (path traversal) and let the copier overwrite an arbitrary file.
   */
  readonly restoreId: string
  /** Producer app version (package.json) — diagnostic only, NOT in the compat gate. */
  readonly producerAppVersion: string
  /** Producer's last applied migration `when` (folderMillis) — the schema-version fingerprint. */
  readonly schemaMigrationId: string
  /**
   * Progress callback (UI-only, never correctness). BackupService wraps this to inject
   * `backupId` + emit/broadcast. Undefined in unit tests (no UI).
   */
  readonly onProgress?: (update: Omit<BackupProgressUpdate, 'backupId'>) => void
  /**
   * Cancel signal — aborts the export at the next step boundary (throws
   * BackupCancelledError). The finally block still cleans up temp + staging.
   */
  readonly signal?: AbortSignal
}

/**
 * A safe filename basename — non-empty, no path separators, no NUL, not `.`/`..`.
 * Guards the temp-copy + staging paths against caller-controlled `restoreId` traversal.
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
  /** Finalized contributor registry — used for topoSort + collectFileResources. */
  readonly registry: ReadonlyBackupRegistry
  /** Temp dir for the DB-copy + blob staging; the orchestrator removes them after archiving. */
  readonly tempDir: string
  /** Live filesystem root for internal file blobs (<id>.<ext>). */
  readonly filesRoot: string
  /** Live filesystem root for knowledge base dirs (<baseId>/). */
  readonly knowledgeRoot: string
  /**
   * Resolves the live Notes markdown root, evaluated fresh per export. Unlike the
   * static roots above, Notes is preference-driven — feature.notes.path may point
   * outside the managed data dir — so a boot-time snapshot would go stale when the
   * user changes their Notes dir mid-session. The resolver lets BackupService read
   * the current preference on each backup instead. See BackupService.resolveNotesRoot.
   */
  readonly notesRoot: () => string
  /** Strips ALWAYS_STRIP + (lite only) excluded-domain rows from the copy (step 2.5). */
  readonly stripper: BackupStripper
}

/** Default conflict strategy stamped on collect contexts (full export = SKIP by id). */
const EXPORT_STRATEGY: ConflictStrategy = 'SKIP'

/**
 * Global physical tables every export strips (full + lite): ALWAYS_STRIP_PHYSICAL_TABLES
 * (app_state / job) — runtime state / job queue. FTS5 virtual tables (message_fts /
 * agent_session_message_fts) are NOT stripped — external-content FTS index binds to
 * the content table, so `DELETE FROM` does not clear the shadow index while content
 * rows survive; restore runs the 'rebuild' command instead.
 * See export-orchestrator.md "ALWAYS_STRIP_TABLES global strip".
 */
const ALWAYS_STRIP_DB_TABLES: readonly DbTableName[] =
  ALWAYS_STRIP_PHYSICAL_TABLES as readonly DbTableName[]

/**
 * Export orchestrator. Pure class (no lifecycle wiring) — BackupService constructs
 * it in onInit; unit tests construct it directly with a stub copier / (real or stub)
 * registry. Opens a read-only drizzle handle on the snapshot DB itself so collect +
 * stage are guaranteed to agree with backup.sqlite.
 */
export class ExportOrchestrator {
  private readonly logger = loggerService.withContext('backup/export')

  constructor(private readonly deps: ExportOrchestratorDeps) {}

  /**
   * Fire a progress tick if a callback is wired. BackupService injects `backupId`
   * before emitting to the renderer, so the orchestrator reports phase/current/total
   * only. No-op when onProgress is undefined (unit tests).
   */
  private emitProgress(
    options: ExportBackupOptions,
    phase: BackupProgressUpdate['phase'],
    current: number,
    total: number,
    message?: string
  ): void {
    options.onProgress?.({ phase, current, total, message })
  }

  /**
   * Throw BackupCancelledError if the caller's AbortSignal is already aborted.
   * Called at each step boundary so cancel latency is bounded — no long synchronous
   * step (copy / archive) blocks cancel past its own boundary.
   */
  private assertNotCancelled(options: ExportBackupOptions): void {
    if (options.signal?.aborted) throw new BackupCancelledError()
  }

  async exportBackup(options: ExportBackupOptions): Promise<ExportBackupResult> {
    // Gate: restoreId is joined into temp + staging paths, so it MUST be a safe basename.
    if (!isSafeBasename(options.restoreId)) {
      throw new Error(
        `ExportOrchestrator: restoreId must be a safe basename (no '/', '\\', NUL, '..', '.') — got ${JSON.stringify(options.restoreId)}`
      )
    }

    const { copier, registry, tempDir, filesRoot, knowledgeRoot, stripper } = this.deps
    // Resolve the Notes root fresh per export (preference-driven, see deps.notesRoot).
    const notesRoot = this.deps.notesRoot()

    // 1. preset → topo-sorted domains (consumers rely on dependency order)
    this.emitProgress(options, 'collect', 0, 0, 'Resolving domains')
    const domains = registry.topoSort(resolvePreset(options.preset))

    // 2. online-copy live DB → temp backup.sqlite
    this.assertNotCancelled(options)
    this.emitProgress(options, 'snapshot', 0, 1, 'Copying live DB')
    const backupDbPath = join(tempDir, `${options.restoreId}.sqlite`)
    // Per-export staging root (isolated from other exports + prior crashed runs).
    const stagingRoot = join(tempDir, `${options.restoreId}-stage`)
    let filesDir: string | undefined
    let knowledgeDir: string | undefined
    let notesDir: string | undefined
    let manifest: BackupManifest
    let snapshotDb: Database.Database | undefined
    try {
      await copier.copyTo(backupDbPath)

      // 2.5 strip the copy BEFORE opening the readonly snapshot (every preset).
      // resolveStripTables combines two sources:
      // - ALWAYS_STRIP physical (app_state / job) — global runtime state / job
      //   queue; stripped on full + lite (spec export-orchestrator.md
      //   "ALWAYS_STRIP_TABLES global strip"). FTS5 virtuals are NOT stripped
      //   (external-content index binds to content; restore rebuilds).
      // - lite only: LITE_EXCLUDED-owned tables — schema CASCADE prunes cross-domain
      //   junction referrers (chat_message_file_ref / assistant_knowledge_base) so a
      //   lite archive never carries rows the manifest claims are absent (spec
      //   "Excluded-domain row strip").
      // The stripper enables `PRAGMA foreign_keys = ON` + DELETEs in one tx + VACUUM.
      this.assertNotCancelled(options)
      this.emitProgress(options, 'collect', 0, 1, 'Stripping runtime tables')
      const stripTables = this.resolveStripTables(options.preset, registry)
      if (stripTables.length > 0) {
        await stripper.strip(backupDbPath, stripTables)
      }

      // Open a READ-ONLY handle on the SNAPSHOT so collect + stage agree exactly
      // with backup.sqlite (the archive's DB). Rows deleted on live between copyTo()
      // and collect cannot desync the archived DB from its blobs.
      snapshotDb = new Database(backupDbPath, { readonly: true })
      const snapshotReadonly = new BackupReadonlyDb(
        drizzle({ client: snapshotDb, casing: 'snake_case' })
      )
      const fileStager = new SqliteFileStager(snapshotReadonly, filesRoot, knowledgeRoot)

      // 4. collectFileResources per domain (transaction-free, spec §flow step 4).
      //    KNOWLEDGE ids are baseIds (directory-shaped → knowledge/<baseId>/);
      //    PREFERENCES ids are Notes markdown relpaths (→ notes/<relPath>);
      //    every other domain's ids are file_entry ids (→ files/<id>).
      const fileIds = new Set<string>()
      const baseIds = new Set<string>()
      const notesRelPaths = new Set<string>()
      const ctx: FileResourceContext = {
        liveDb: snapshotReadonly,
        registry,
        restoreId: options.restoreId,
        domains,
        strategy: EXPORT_STRATEGY,
        logger: this.logger,
        // notesRoot on the context is optional (undefined in unit tests); deps.notesRoot
        // is a resolver BackupService evaluates per export (feature.notes.path preference,
        // falling back to feature.notes.data). PREFERENCES' collectFileResources scans it.
        notesRoot
      }
      let collected = 0
      for (const d of domains) {
        this.assertNotCancelled(options)
        // PREFERENCES' file resource (Notes markdown bodies) is full-preset only. lite
        // keeps the `note` overlay rows (they travel in backup.sqlite) but must NOT
        // archive note bodies (spec simple-domains.md "精简模式一致性"). Skip collection
        // so lite never stages notes — even when the contributor hook would return paths
        // (and so an unreadable Notes root can't fail a lite export that excludes notes).
        if (d === 'PREFERENCES' && options.preset !== 'full') {
          collected += 1
          this.emitProgress(options, 'collect', collected, domains.length, 'Collecting file resources')
          continue
        }
        const ids = (await registry.getOperations(d)?.collectFileResources?.(ctx)) ?? new Set<string>()
        // Route by domain shape: KNOWLEDGE → baseIds, PREFERENCES → notes relpaths,
        // everything else → file_entry ids.
        if (d === 'KNOWLEDGE') {
          for (const id of ids) baseIds.add(id)
        } else if (d === 'PREFERENCES') {
          for (const id of ids) notesRelPaths.add(id)
        } else {
          for (const id of ids) fileIds.add(id)
        }
        collected += 1
        this.emitProgress(options, 'collect', collected, domains.length, 'Collecting file resources')
      }

      // Stage blobs into the per-export staging root (missing sources skipped, not fatal;
      // destination write errors abort — see SqliteFileStager).
      this.assertNotCancelled(options)
      this.emitProgress(options, 'collect', 0, 1, 'Staging blobs')
      let filesTotal = 0
      let filesBytes = 0
      let knowledgeBases: readonly string[] = []
      let filesMissing: readonly string[] = []
      let knowledgeMissing: readonly string[] = []
      let notesPaths: readonly string[] = []
      if (fileIds.size > 0) {
        filesDir = join(stagingRoot, 'files')
        const r = await fileStager.stageFiles(fileIds, filesDir)
        filesTotal = r.total
        filesBytes = r.totalBytes
        filesMissing = r.missing
      }
      if (baseIds.size > 0) {
        knowledgeDir = join(stagingRoot, 'knowledge')
        const r = await fileStager.stageKnowledge(baseIds, knowledgeDir)
        knowledgeBases = r.bases
        knowledgeMissing = r.missing
      }
      if (notesRelPaths.size > 0) {
        notesDir = join(stagingRoot, 'notes')
        const r = await fileStager.stageNotes(notesRoot, notesRelPaths, notesDir)
        // notes are NOT DB-gated (the note table holds overlays, not bodies) → missing
        // notes never prune a DB row. manifest.notes lists only what was actually staged.
        notesPaths = r.paths
      }

      // 4.5 DB↔staged alignment (spec export-orchestrator.md "Staged blob set 驱动
      // manifest + DB 裁剪"). A snapshot row whose blob/dir was missing at stage
      // time must not survive into the archive — otherwise restore re-creates a
      // row pointing at a file the archive never held (restore残缺). Close the
      // readonly snapshot, then DELETE missing rows from backup.sqlite (file_ref /
      // knowledge_item cascade via FK). This is the export-time dual of step 2.5
      // strip, driven by the staged set rather than the preset.
      if (snapshotDb) {
        snapshotDb.close()
        snapshotDb = undefined
      }
      await this.pruneMissingRows(backupDbPath, filesMissing, knowledgeMissing)

      // staged ids = collected − missing (per-file manifest for restore cross-check).
      const stagedFileIds = [...fileIds].filter((id) => !filesMissing.includes(id))

      // 5. build manifest reflecting what was actually staged.
      manifest = {
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        preset: options.preset,
        domains,
        includeFiles: filesTotal > 0,
        includeKnowledgeFiles: knowledgeBases.length > 0,
        sensitiveData: { included: true, rotated: false },
        schemaMigrationId: options.schemaMigrationId,
        producerAppVersion: options.producerAppVersion,
        files: { ids: stagedFileIds, total: filesTotal, totalBytes: filesBytes },
        knowledge: { bases: [...knowledgeBases] },
        notes: { paths: [...notesPaths] }
      }

      this.assertNotCancelled(options)
      this.emitProgress(options, 'archive', 0, 1, 'Archiving')
      await assembleArchive(
        options.outputPath,
        { manifest, dbCopyPath: backupDbPath, filesDir, knowledgeDir, notesDir },
        options.signal
      )
    } finally {
      // Always close the snapshot + remove the temp copy + the whole staging root.
      // On success the archive holds its own byte copy; on failure nothing leaks.
      snapshotDb?.close()
      await unlink(backupDbPath).catch(() => {})
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
    }

    return { archivePath: options.outputPath, manifest }
  }

  /**
   * Resolve the preset-aware strip table set (DbTableName[]) for step 2.5.
   *
   * - full: ALWAYS_STRIP_DB_TABLES (app_state / job) — global runtime state / job
   *   queue; stripped on every export.
   * - lite: full set ∪ LITE_EXCLUDED-owned tables (registry.getSchema(d).tables).
   *   CASCADE prunes cross-domain junction referrers so a lite archive never
   *   carries rows the manifest claims are absent.
   *
   * FTS5 virtual tables are intentionally absent — external-content FTS index binds
   * to the content table (cannot be stripped independently); restore rebuilds.
   */
  private resolveStripTables(preset: 'full' | 'lite', registry: ReadonlyBackupRegistry): readonly DbTableName[] {
    const tables = new Set<DbTableName>(ALWAYS_STRIP_DB_TABLES)
    if (preset === 'lite') {
      for (const d of LITE_EXCLUDED) {
        for (const t of registry.getSchema(d).tables) tables.add(t)
      }
    }
    return [...tables]
  }

  /**
   * Delete file_entry / knowledge_base rows whose blob/dir was missing at stage
   * time, so backup.sqlite rows ↔ staged files are 1:1 (no restore残缺: a row
   * pointing at a file the archive never held). Opens a write connection to the
   * snapshot DB; file_ref (chat_message_file_ref / painting_file_ref) and
   * knowledge_item cascade via FK (PRAGMA foreign_keys = ON). No-op when nothing
   * was missing. Table names are the stable resource-root tables owned by
   * FILE_STORAGE / KNOWLEDGE; FK CASCADE removes their members.
   */
  private async pruneMissingRows(
    backupDbPath: string,
    filesMissing: readonly string[],
    knowledgeMissing: readonly string[]
  ): Promise<void> {
    if (filesMissing.length === 0 && knowledgeMissing.length === 0) return
    const db = new Database(backupDbPath)
    try {
      db.pragma('foreign_keys = ON')
      // Chunk to stay under SQLITE_MAX_VARIABLE_NUMBER (default 999); matches
      // SqliteFileStager's chunked IN(...) lookup.
      const CHUNK = 500
      const deleteIds = (table: string, ids: readonly string[]): void => {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const batch = ids.slice(i, i + CHUNK)
          const placeholders = batch.map(() => '?').join(',')
          // Cascade FKs remove dependent rows (file_ref.fileEntryId / knowledge_item.baseId).
          db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).run(...batch)
        }
      }
      if (filesMissing.length > 0) deleteIds('file_entry', filesMissing)
      if (knowledgeMissing.length > 0) deleteIds('knowledge_base', knowledgeMissing)
    } finally {
      db.close()
    }
  }
}
