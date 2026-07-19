// ExportOrchestrator — produces a .cbu backup archive from the current app state.
//
// Pipeline (the ExportOrchestrator 5-step pipeline):
//   1. resolvePreset → topo-sorted domain set
//   2. dbService.backupTo(temp) — online `db.backup()` of live DB → backup.sqlite
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
// a row deleted on live between backupTo() and collect would leave backup.sqlite
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
import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import type {
  ExportResourceDegradation,
  FileResourceContext,
  ReadonlyBackupRegistry
} from '@main/data/db/backup/contributorTypes'
import { type DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import type { ConflictStrategy } from '@main/data/db/backup/domains'
import { ALWAYS_STRIP_PHYSICAL_TABLES } from '@main/data/db/backup/exclusions'
import type { DbService } from '@main/data/db/DbService'
import type { BackupProgressUpdate } from '@shared/types/backup'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { assembleArchive } from './archive'
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
  id.length > 0 && !id.includes('/') && !id.includes('\\') && !id.includes('\0') && id !== '.' && id !== '..'

export interface ExportBackupResult {
  readonly archivePath: string
  readonly manifest: BackupManifest
}

/** Constructor dependencies (injected for testability). */
export interface ExportOrchestratorDeps {
  /** Copies live DB → a temp backup.sqlite using SQLite's online backup API. */
  readonly dbService: Pick<DbService, 'backupTo'>
  /** Finalized contributor registry — used for topoSort + collectFileResources. */
  readonly registry: ReadonlyBackupRegistry
  /** Temp dir for the DB-copy + blob staging; the orchestrator removes them after archiving. */
  readonly tempDir: string
  /** Read-only file blob copy (production: FileManager.copyContentTo). */
  readonly fileBlobs: {
    copyContentTo(id: string, destPath: string): Promise<{ size: number }>
    getMetadata(id: string): Promise<{ size: number }>
  }
  /** Live filesystem root for knowledge base dirs (<baseId>/). */
  readonly knowledgeRoot: string
  /** Live filesystem root for installed skill dirs (<folderName>/, full preset only). */
  readonly skillsRoot: string
  /**
   * Resolves the live Notes markdown root, evaluated fresh per export. Unlike the
   * static roots above, Notes is preference-driven — feature.notes.path may point
   * outside the managed data dir — so a boot-time snapshot would go stale when the
   * user changes their Notes dir mid-session. The resolver lets BackupService read
   * the current preference on each backup instead. See BackupService.resolveNotesRoot.
   */
  /** Returns undefined when Notes is not configured / managed default absent. */
  readonly notesRoot: () => string | undefined
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
 * See ALWAYS_STRIP_TABLES global strip.
 */
const ALWAYS_STRIP_DB_TABLES: readonly DbTableName[] = ALWAYS_STRIP_PHYSICAL_TABLES as readonly DbTableName[]

const logger = loggerService.withContext('backup/ExportOrchestrator')

/**
 * Export orchestrator. Pure class (no lifecycle wiring) — BackupService constructs
 * it in onInit; unit tests construct it directly with a fixture DB service / registry.
 * Opens a read-only drizzle handle on the snapshot DB itself so collect +
 * stage are guaranteed to agree with backup.sqlite.
 */
export class ExportOrchestrator {
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

    const { dbService, registry, tempDir, fileBlobs, knowledgeRoot, skillsRoot, stripper } = this.deps
    // Notes root is only needed for full-preset PREFERENCES file resources.
    // Resolve lazily below — calling notesRoot() here would abort lite exports when
    // feature.notes.path is set but unavailable, even though lite never stages notes.
    let notesRoot: string | undefined

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
    let skillsDir: string | undefined
    let manifest: BackupManifest
    let snapshotDb: Database.Database | undefined
    try {
      await dbService.backupTo(backupDbPath)

      // 2.5 strip the copy BEFORE opening the readonly snapshot (every preset).
      // resolveStripTables combines two sources:
      // - ALWAYS_STRIP physical (app_state / job) — global runtime state / job
      //   queue; stripped on full + lite (ALWAYS_STRIP_TABLES global strip).
      //   FTS5 virtuals are NOT stripped
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

      // 2.6 apply contributor rowScopes — delete rows OUTSIDE each contributor's owned
      // partition (e.g. AGENTS owns job_schedule where type='agent.task'; other types
      // are runtime state). Runs after the stripper + before the readonly snapshot
      // opens, same write-connection + foreign_keys=ON pattern as pruneMissingRows.
      this.assertNotCancelled(options)
      await this.applyRowScopes(backupDbPath, registry)

      // Open a READ-ONLY handle on the SNAPSHOT so collect + stage agree exactly
      // with backup.sqlite (the archive's DB). Rows deleted on live between backupTo()
      // and collect cannot desync the archived DB from its blobs.
      snapshotDb = new Database(backupDbPath, { readonly: true })
      const snapshotReadonly = new BackupReadonlyDb(drizzle({ client: snapshotDb, casing: 'snake_case' }))
      const fileStager = new SqliteFileStager(snapshotReadonly, fileBlobs, knowledgeRoot, skillsRoot)

      // 4. collectFileResources per domain (transaction-free, spec §flow step 4).
      //    KNOWLEDGE ids are baseIds (directory-shaped → knowledge/<baseId>/);
      //    PREFERENCES ids are Notes markdown relpaths (→ notes/<relPath>);
      //    every other domain's ids are file_entry ids (→ files/<id>).
      const fileIds = new Set<string>()
      const baseIds = new Set<string>()
      const notesRelPaths = new Set<string>()
      const skillDirs: { folderName: string; contentHash: string }[] = []
      // TBD-1 (iii): full collects zip/local skill-dir content; lite keeps SKILLS schema
      // but the contributor records each zip/local omission here (observable, never silent).
      const degradedResources: ExportResourceDegradation[] = []
      // Resolve Notes root only when full preset will collect PREFERENCES file resources.
      // lite keeps `note` overlay rows in backup.sqlite but must NOT archive bodies —
      // and must not fail on an unavailable custom Notes path.
      if (options.preset === 'full' && domains.includes('PREFERENCES')) {
        notesRoot = this.deps.notesRoot()
      }
      const ctx: FileResourceContext = {
        liveDb: snapshotReadonly,
        registry,
        restoreId: options.restoreId,
        domains,
        strategy: EXPORT_STRATEGY,
        preset: options.preset,
        // SKILLS calls this under lite to record zip/local skill content omissions;
        // logged here (single owner) + accumulated into manifest.degraded.
        recordDegraded: (item) => {
          degradedResources.push(item)
          logger.warn('backup: skill content omitted under preset', {
            preset: options.preset,
            kind: item.kind,
            folderName: item.folderName
          })
        },
        // notesRoot is undefined for lite / unit stubs; full resolves via deps.notesRoot
        // (feature.notes.path when set, else feature.notes.data; unavailable custom fails).
        notesRoot
      }
      let collected = 0
      for (const d of domains) {
        this.assertNotCancelled(options)
        // PREFERENCES' file resource (Notes markdown bodies) is full-preset only.
        if (d === 'PREFERENCES' && options.preset !== 'full') {
          collected += 1
          this.emitProgress(options, 'collect', collected, domains.length, 'Collecting file resources')
          continue
        }
        const descs = (await registry.getOperations(d)?.collectFileResources?.(ctx)) ?? []
        // Route by descriptor kind (not producing domain) — new resource forms extend
        // the union without a domain switch.
        for (const desc of descs) {
          switch (desc.kind) {
            case 'file-entry':
              fileIds.add(desc.fileEntryId)
              break
            case 'knowledge-base':
              baseIds.add(desc.baseId)
              break
            case 'notes-file':
              notesRelPaths.add(desc.relPath)
              break
            case 'skill-dir':
              skillDirs.push({ folderName: desc.folderName, contentHash: desc.contentHash })
              break
            case 'mcp-package-dir':
            case 'agent-workspace-dir':
              // MCP/AGENTS directory staging follows the same contract (audit-confirmed
              // analogous P0s); SKILLS implements first.
              throw new Error(`backup: directory resource staging not implemented (${desc.kind})`)
            default: {
              const _exhaustive: never = desc
              throw new Error(`backup: unknown ResourceDescriptor kind ${(_exhaustive as { kind: string }).kind}`)
            }
          }
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
      let skillsStaged: readonly { folderName: string; contentHash: string }[] = []
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
      if (skillDirs.length > 0) {
        skillsDir = join(stagingRoot, 'skills')
        const r = await fileStager.stageSkillDirs(skillDirs, skillsDir)
        skillsStaged = r.skills
      }
      if (notesRelPaths.size > 0) {
        // notesRelPaths is only populated on full + PREFERENCES collect, which
        // resolves notesRoot above — refuse to stage without it.
        if (!notesRoot) {
          throw new Error('ExportOrchestrator: notesRelPaths non-empty but notesRoot unresolved')
        }
        notesDir = join(stagingRoot, 'notes')
        const r = await fileStager.stageNotes(notesRoot, notesRelPaths, notesDir)
        // notes are NOT DB-gated (overlays stay in backup.sqlite even when a body is
        // absent) — so a missing collected body would yield a "successful" archive
        // with orphan overlays. Fail closed: every collected relPath must stage.
        if (r.missing.length > 0) {
          throw new Error(
            `ExportOrchestrator: notes body missing after collect (${r.missing.length}): ${r.missing.slice(0, 5).join(', ')}`
          )
        }
        notesPaths = r.paths
      }

      // 4.5 DB↔staged alignment (the staged blob set drives manifest + DB pruning).
      // A snapshot row whose blob/dir was missing at stage
      // time must not survive into the archive — otherwise restore re-creates a
      // row pointing at a file the archive never held (incomplete restore). Close the
      // readonly snapshot, then DELETE missing rows from backup.sqlite (file_ref /
      // knowledge_item cascade via FK). This is the export-time dual of step 2.5
      // strip, driven by the staged set rather than the preset.
      if (snapshotDb) {
        snapshotDb.close()
        snapshotDb = undefined
      }
      await this.pruneMissingRows(backupDbPath, filesMissing, knowledgeMissing)

      // 4.6 final VACUUM — after ALL export-time DELETEs (stripper step 2.5 + rowScopes
      // 2.6 + pruneMissingRows 4.5), rewrite backup.sqlite so deleted rows (excluded
      // runtime payload, e.g. non-agent.task job_schedule) do not survive in freelist
      // pages — recoverable from the archive otherwise (secure_delete is off in this
      // SQLite build). VACUUM runs on the closed snapshot, before archive assembly.
      this.assertNotCancelled(options)
      await this.vacuumFinal(backupDbPath)

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
        skills: { folders: [...skillsStaged] },
        notes: { paths: [...notesPaths] },
        degraded: { resources: [...degradedResources] }
      }

      this.assertNotCancelled(options)
      this.emitProgress(options, 'archive', 0, 1, 'Archiving')
      await assembleArchive(
        options.outputPath,
        { manifest, dbCopyPath: backupDbPath, filesDir, knowledgeDir, skillsDir, notesDir },
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
   * time, so backup.sqlite rows ↔ staged files are 1:1 (no incomplete restore: a row
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
      // Table names are string literals (no parameterization → no injection
      // surface); each helper hardcodes its own table. CASCADE FKs remove
      // dependent rows (file_ref.fileEntryId / knowledge_item.baseId).
      const deleteFileEntries = (ids: readonly string[]): void => {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const batch = ids.slice(i, i + CHUNK)
          const placeholders = batch.map(() => '?').join(',')
          db.prepare(`DELETE FROM file_entry WHERE id IN (${placeholders})`).run(...batch)
        }
      }
      const deleteKnowledgeBases = (ids: readonly string[]): void => {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const batch = ids.slice(i, i + CHUNK)
          const placeholders = batch.map(() => '?').join(',')
          db.prepare(`DELETE FROM knowledge_base WHERE id IN (${placeholders})`).run(...batch)
        }
      }
      if (filesMissing.length > 0) deleteFileEntries(filesMissing)
      if (knowledgeMissing.length > 0) deleteKnowledgeBases(knowledgeMissing)
    } finally {
      db.close()
    }
  }

  /**
   * Apply contributor `rowScopes` to the snapshot: delete rows OUTSIDE each scope's
   * owned partition. A rowScope declares the partition a contributor owns (e.g. AGENTS
   * owns job_schedule where type='agent.task'); rows outside are runtime state that
   * must not ship in the archive — without this the archive carries runtime rows the
   * manifest does not claim to back up. Same write-connection + foreign_keys=ON
   * pattern as pruneMissingRows, run right after the stripper (step 2.6) so the
   * readonly snapshot opens on the already-pruned copy.
   */
  private async applyRowScopes(backupDbPath: string, registry: ReadonlyBackupRegistry): Promise<void> {
    // Gather scopes across all domains (full topo — a scope's table is owned by one
    // domain, so the registry is the single source of truth).
    const scopes: { table: DbTableName; column: string; value: string }[] = []
    for (const d of registry.topoSort(resolvePreset('full'))) {
      const rowScopes = registry.getSchema(d).rowScopes
      if (rowScopes) {
        for (const rs of rowScopes) {
          if (rs.filter.op === 'eq') {
            scopes.push({ table: rs.table, column: rs.filter.column, value: rs.filter.value })
          }
        }
      }
    }
    if (scopes.length === 0) return
    const db = new Database(backupDbPath)
    try {
      db.pragma('foreign_keys = ON')
      db.exec('BEGIN')
      for (const s of scopes) {
        // table/column are codegen-validated literals (DbTableName/DbColumnName from
        // dbSchemaRefs) — not user input, no injection surface. value is parameterized.
        db.prepare(`DELETE FROM "${s.table}" WHERE "${s.column}" != ?`).run(s.value)
      }
      db.exec('COMMIT')
    } finally {
      db.close()
    }
  }

  /**
   * Final VACUUM after all export-time DELETEs (stripper + rowScopes + pruneMissingRows).
   * Without it, deleted rows — excluded runtime payload like non-agent.task job_schedule —
   * survive in the file's freelist pages and are recoverable from the archive (secure_delete
   * is off in this SQLite build). VACUUM rewrites the file with only live pages, so the
   * archive carries no excluded payload. Run on the closed snapshot before archive assembly.
   */
  private async vacuumFinal(backupDbPath: string): Promise<void> {
    const db = new Database(backupDbPath)
    try {
      db.exec('VACUUM')
    } finally {
      db.close()
    }
  }
}
