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

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { loggerService } from '@logger'
import { BackupReadonlyDb, type FileResourceContext } from '@main/data/db/backup/contexts'
import type { ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { ConflictStrategy } from '@main/data/db/backup/domains'

import { assembleArchive } from './archive'
import type { BackupDbCopier } from './BackupDbCopier'
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
  /** Strips excluded-domain rows from the copy on lite preset (step 2.5). */
  readonly stripper: BackupStripper
}

/** Default conflict strategy stamped on collect contexts (full export = SKIP by id). */
const EXPORT_STRATEGY: ConflictStrategy = 'SKIP'

/**
 * Export orchestrator. Pure class (no lifecycle wiring) — BackupService constructs
 * it in onInit; unit tests construct it directly with a stub copier / (real or stub)
 * registry. Opens a read-only drizzle handle on the snapshot DB itself so collect +
 * stage are guaranteed to agree with backup.sqlite.
 */
export class ExportOrchestrator {
  private readonly logger = loggerService.withContext('backup/export')

  constructor(private readonly deps: ExportOrchestratorDeps) {}

  async exportBackup(options: ExportBackupOptions): Promise<ExportBackupResult> {
    // Gate: restoreId is joined into temp + staging paths, so it MUST be a safe basename.
    if (!isSafeBasename(options.restoreId)) {
      throw new Error(
        `ExportOrchestrator: restoreId must be a safe basename (no '/', '\\', NUL, '..', '.') — got ${JSON.stringify(options.restoreId)}`
      )
    }

    const { copier, registry, tempDir, filesRoot, knowledgeRoot, stripper } = this.deps

    // 1. preset → topo-sorted domains (consumers rely on dependency order)
    const domains = registry.topoSort(resolvePreset(options.preset))

    // 2. online-copy live DB → temp backup.sqlite
    const backupDbPath = join(tempDir, `${options.restoreId}.sqlite`)
    // Per-export staging root (isolated from other exports + prior crashed runs).
    const stagingRoot = join(tempDir, `${options.restoreId}-stage`)
    let filesDir: string | undefined
    let knowledgeDir: string | undefined
    let manifest: BackupManifest
    let snapshotDb: Database.Database | undefined
    try {
      await copier.copyTo(backupDbPath)

      // 2.5 lite: physically strip excluded-domain rows from the copy BEFORE opening
      // the readonly snapshot. The stripper enables `PRAGMA foreign_keys = ON` and
      // DELETEs the excluded tables — schema CASCADE prunes cross-domain junction
      // referrers (chat_message_file_ref / assistant_knowledge_base), so a lite
      // archive never carries rows the manifest claims are absent (spec
      // export-orchestrator.md "Excluded-domain row strip"). Full preset skips this.
      if (options.preset === 'lite') {
        await stripper.strip(backupDbPath, LITE_EXCLUDED)
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
      //    every other domain's ids are file_entry ids (→ files/<id>).
      const fileIds = new Set<string>()
      const baseIds = new Set<string>()
      const ctx: FileResourceContext = {
        liveDb: snapshotReadonly,
        registry,
        restoreId: options.restoreId,
        domains,
        strategy: EXPORT_STRATEGY,
        logger: this.logger
      }
      for (const d of domains) {
        const ids = (await registry.getOperations(d)?.collectFileResources?.(ctx)) ?? new Set<string>()
        const target = d === 'KNOWLEDGE' ? baseIds : fileIds
        for (const id of ids) target.add(id)
      }

      // Stage blobs into the per-export staging root (missing sources skipped, not fatal;
      // destination write errors abort — see SqliteFileStager).
      let filesTotal = 0
      let filesBytes = 0
      let knowledgeBases: readonly string[] = []
      if (fileIds.size > 0) {
        filesDir = join(stagingRoot, 'files')
        const r = await fileStager.stageFiles(fileIds, filesDir)
        filesTotal = r.total
        filesBytes = r.totalBytes
      }
      if (baseIds.size > 0) {
        knowledgeDir = join(stagingRoot, 'knowledge')
        const r = await fileStager.stageKnowledge(baseIds, knowledgeDir)
        knowledgeBases = r.bases
      }

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
        files: { total: filesTotal, totalBytes: filesBytes },
        knowledge: { bases: [...knowledgeBases] }
      }

      await assembleArchive(options.outputPath, { manifest, dbCopyPath: backupDbPath, filesDir, knowledgeDir })
    } finally {
      // Always close the snapshot + remove the temp copy + the whole staging root.
      // On success the archive holds its own byte copy; on failure nothing leaks.
      snapshotDb?.close()
      await unlink(backupDbPath).catch(() => {})
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
    }

    return { archivePath: options.outputPath, manifest }
  }
}
