/**
 * Orphan sweep — Phase 1b.4 startup data-consistency pass.
 *
 * Two surfaces composed under one module:
 *
 * 1. **OrphanRefScanner** (DB-level, RFC §6.4): walks `file_ref.sourceId`
 *    distinct values per sourceType, asks the corresponding
 *    `SourceTypeChecker` which ones still exist, deletes the rest. Adding a
 *    new `FileRefSourceType` without a checker is a compile error
 *    (Record<FileRefSourceType, SourceTypeChecker<...>>).
 *
 * 2. **runStartupFileSweep** (FS-level, architecture §10): enumerates
 *    `{userData}/files/` for UUID-named files without a matching DB entry
 *    and abandoned `*.tmp-<uuid>` residue, applies the `mtime > 5min`
 *    heuristic and the safety threshold, then unlinks the survivors. Lands
 *    in subsequent Group D commits.
 *
 * Both surfaces emit a single structured log record per run via
 * `loggerService` (events `orphan-sweep` / `orphan-file-sweep`).
 */

import type { FileEntryService } from '@data/services/FileEntryService'
import type { FileRefService } from '@data/services/FileRefService'
import type { OrphanCheckerRegistry } from '@data/services/orphan/FileRefCheckerRegistry'
import { loggerService } from '@logger'
import type { FileEntryOrigin, FileRefSourceType } from '@shared/data/types/file'

import type { FileManagerDeps } from './deps'

const logger = loggerService.withContext('file/orphanSweep')

// ─── DB-level: OrphanRefScanner ───

export interface OrphanRefScannerDeps {
  readonly fileRefService: FileRefService
  readonly registry: OrphanCheckerRegistry
}

export interface OrphanRefScanResult {
  readonly total: number
  readonly byType: Partial<Record<FileRefSourceType, number>>
}

export class OrphanRefScanner {
  constructor(private readonly deps: OrphanRefScannerDeps) {}

  /**
   * Scan one sourceType's refs:
   * 1. SELECT DISTINCT sourceId FROM file_ref WHERE sourceType = ?
   * 2. checker.checkExists(sourceIds) → alive set
   * 3. DELETE refs whose sourceId ∉ alive
   *
   * Returns the number of `file_ref` rows deleted.
   */
  async scanOneType(sourceType: FileRefSourceType): Promise<number> {
    const sourceIds = await this.deps.fileRefService.listDistinctSourceIds(sourceType)
    if (sourceIds.length === 0) return 0
    const alive = await this.deps.registry[sourceType].checkExists(sourceIds)
    const orphans = sourceIds.filter((id) => !alive.has(id))
    if (orphans.length === 0) return 0
    return this.deps.fileRefService.cleanupBySourceBatch(sourceType, orphans)
  }

  async scanAll(): Promise<OrphanRefScanResult> {
    const sourceTypes = Object.keys(this.deps.registry) as FileRefSourceType[]
    const byType: Partial<Record<FileRefSourceType, number>> = {}
    let total = 0
    for (const sourceType of sourceTypes) {
      const removed = await this.scanOneType(sourceType)
      byType[sourceType] = removed
      total += removed
    }
    return { total, byType }
  }
}

// ─── Orphan-entry report (no deletion — see file-manager-architecture §7.1) ───

export interface OrphanEntryReport {
  readonly total: number
  readonly byOrigin: Partial<Record<FileEntryOrigin, number>>
}

export interface ScanOrphanEntriesDeps {
  readonly fileEntryService: FileEntryService
}

/**
 * Identify active entries with zero `file_ref` rows pointing at them. The
 * default policy in architecture §7.1 is "preserve" — this scan only
 * **reports**; cleanup belongs to user-driven UI flows or to the narrow
 * dangling-external auto-cleanup pass (architecture §7.2, deferred).
 */
export async function scanOrphanEntries(deps: ScanOrphanEntriesDeps): Promise<OrphanEntryReport> {
  const rows = await deps.fileEntryService.findUnreferenced()
  const byOrigin: Partial<Record<FileEntryOrigin, number>> = {}
  for (const row of rows) {
    byOrigin[row.origin] = (byOrigin[row.origin] ?? 0) + 1
  }
  return { total: rows.length, byOrigin }
}

// ─── DB-sweep umbrella + observability ───

export interface RunDbSweepDeps {
  readonly fileEntryService: FileEntryService
  readonly fileRefService: FileRefService
  readonly registry: OrphanCheckerRegistry
}

export interface DbSweepReport {
  readonly outcome: 'completed' | 'failed'
  readonly orphanRefsByType: Partial<Record<FileRefSourceType, number>>
  readonly orphanRefsTotal: number
  readonly orphanEntriesByOrigin: Partial<Record<FileEntryOrigin, number>>
  readonly orphanEntriesTotal: number
  readonly scanDurationMs: number
  readonly errorMessage?: string
}

/**
 * Run both DB-level passes (orphan refs + orphan-entry report) and emit a
 * single structured `orphan-sweep` log record. On unexpected failure the
 * record's outcome is `'failed'` and the error message is attached for
 * post-hoc diagnosis. Caller decides whether to fire-and-forget (FileManager
 * does this in `onInit`).
 */
export async function runDbSweep(deps: RunDbSweepDeps): Promise<DbSweepReport> {
  const startedAt = Date.now()
  try {
    const scanner = new OrphanRefScanner({ fileRefService: deps.fileRefService, registry: deps.registry })
    const refs = await scanner.scanAll()
    const entries = await scanOrphanEntries({ fileEntryService: deps.fileEntryService })
    const report: DbSweepReport = {
      outcome: 'completed',
      orphanRefsByType: refs.byType,
      orphanRefsTotal: refs.total,
      orphanEntriesByOrigin: entries.byOrigin,
      orphanEntriesTotal: entries.total,
      scanDurationMs: Date.now() - startedAt
    }
    logger.info('orphan-sweep', { event: 'orphan-sweep', ...report })
    return report
  } catch (err) {
    const failed: DbSweepReport = {
      outcome: 'failed',
      orphanRefsByType: {},
      orphanRefsTotal: 0,
      orphanEntriesByOrigin: {},
      orphanEntriesTotal: 0,
      scanDurationMs: Date.now() - startedAt,
      errorMessage: (err as Error).message
    }
    logger.error('orphan-sweep', { event: 'orphan-sweep', ...failed })
    return failed
  }
}

// ─── FS-level: runStartupFileSweep (Group D — landing in subsequent commits) ───

export type FileManagerDepsForSweep = FileManagerDeps
