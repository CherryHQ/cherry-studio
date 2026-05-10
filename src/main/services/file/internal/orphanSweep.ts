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

import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { FileEntryService } from '@data/services/FileEntryService'
import type { FileRefService } from '@data/services/FileRefService'
import type { OrphanCheckerRegistry } from '@data/services/orphan/FileRefCheckerRegistry'
import { loggerService } from '@logger'
import type { FileEntryId, FileEntryOrigin, FileRefSourceType } from '@shared/data/types/file'

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

// ─── FS-level: runStartupFileSweep (architecture §10) ───

/** UUID 8-4-4-4-12 hex. Matches both v4 (atomic-write tmp suffix) and v7 (entry id). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** UUID file: `<UUID>.<ext>` or just `<UUID>` (no extension). */
function isUuidFileName(name: string): { id: string } | null {
  const dotIndex = name.indexOf('.')
  const stem = dotIndex < 0 ? name : name.slice(0, dotIndex)
  return UUID_RE.test(stem) ? { id: stem } : null
}

/** Atomic-write tmp residue: `<anything>.tmp-<UUID>`. */
function isTmpResidueName(name: string): boolean {
  const tmpIdx = name.lastIndexOf('.tmp-')
  if (tmpIdx < 0) return false
  const suffix = name.slice(tmpIdx + '.tmp-'.length)
  return UUID_RE.test(suffix)
}

/** mtime gate per architecture §10.3 — files newer than this are presumed in-flight. */
const FRESHNESS_GATE_MS = 5 * 60 * 1000

/** Architecture §10.4 safety thresholds — absolute floor below which any plan is fine. */
const SMALL_RESIDUE_COUNT_FLOOR = 20
const SMALL_RESIDUE_BYTES_FLOOR = 10 * 1024 * 1024
/** Above the floor, abort if the plan covers more than this fraction of total. */
const ABORT_FRACTION = 0.5

export interface RunStartupFileSweepDeps {
  readonly fileEntryService: Pick<FileEntryService, 'listAllIds'>
  /** Test seam — defaults to `Date.now`. */
  readonly now?: () => number
}

export interface FileSweepReport {
  readonly outcome: 'completed' | 'aborted' | 'failed'
  readonly entriesInDb: number
  readonly filesOnDisk: number
  readonly bytesOnDisk: number
  readonly plannedDeleteCount: number
  readonly plannedDeleteBytes: number
  readonly actualDeleteCount: number
  readonly actualDeleteBytes: number
  readonly scanDurationMs: number
  readonly abortReason?: 'count-fraction' | 'byte-fraction'
  readonly errorMessage?: string
}

/**
 * Enumerate `{userData}/files/` and unlink:
 *   - UUID-named files whose id is not in the FileEntry snapshot
 *   - `*.tmp-<UUID>` atomic-write residue
 *
 * Group D-1 ships the readdir + plan + execute path; D-2 layers on the
 * mtime>5min freshness gate; D-3 layers on the safety threshold.
 */
export async function runStartupFileSweep(deps: RunStartupFileSweepDeps): Promise<FileSweepReport> {
  const report = await runStartupFileSweepInner(deps)
  if (report.outcome === 'aborted') {
    logger.warn('orphan-file-sweep', { event: 'orphan-file-sweep', ...report })
  } else if (report.outcome === 'failed') {
    logger.error('orphan-file-sweep', { event: 'orphan-file-sweep', ...report })
  } else {
    logger.info('orphan-file-sweep', { event: 'orphan-file-sweep', ...report })
  }
  return report
}

async function runStartupFileSweepInner(deps: RunStartupFileSweepDeps): Promise<FileSweepReport> {
  const startedAt = Date.now()
  try {
    const filesDir = application.getPath('feature.files.data')
    const idSnapshot: Set<FileEntryId> = await deps.fileEntryService.listAllIds()

    let dirents: string[]
    try {
      dirents = await readdir(filesDir)
    } catch {
      // Files dir doesn't exist yet — nothing to sweep.
      return {
        outcome: 'completed',
        entriesInDb: idSnapshot.size,
        filesOnDisk: 0,
        bytesOnDisk: 0,
        plannedDeleteCount: 0,
        plannedDeleteBytes: 0,
        actualDeleteCount: 0,
        actualDeleteBytes: 0,
        scanDurationMs: Date.now() - startedAt
      }
    }

    const now = (deps.now ?? Date.now)()
    const planned: { path: string; bytes: number }[] = []
    let bytesOnDisk = 0
    for (const name of dirents) {
      const fullPath = path.join(filesDir, name)
      let st
      try {
        st = await stat(fullPath)
      } catch {
        continue
      }
      bytesOnDisk += st.size
      const uuid = isUuidFileName(name)
      const isCandidate = uuid ? !idSnapshot.has(uuid.id) : isTmpResidueName(name)
      if (!isCandidate) continue
      if (now - st.mtimeMs <= FRESHNESS_GATE_MS) continue
      planned.push({ path: fullPath, bytes: st.size })
    }

    const plannedBytes = planned.reduce((s, p) => s + p.bytes, 0)
    const abortReason = pickAbortReason({
      planned: planned.length,
      plannedBytes,
      filesOnDisk: dirents.length,
      bytesOnDisk
    })
    if (abortReason) {
      return {
        outcome: 'aborted',
        entriesInDb: idSnapshot.size,
        filesOnDisk: dirents.length,
        bytesOnDisk,
        plannedDeleteCount: planned.length,
        plannedDeleteBytes: plannedBytes,
        actualDeleteCount: 0,
        actualDeleteBytes: 0,
        scanDurationMs: Date.now() - startedAt,
        abortReason
      }
    }

    let actualDeleted = 0
    let actualBytes = 0
    for (const target of planned) {
      try {
        await unlink(target.path)
        actualDeleted++
        actualBytes += target.bytes
      } catch {
        // best-effort; missing file is fine
      }
    }

    return {
      outcome: 'completed',
      entriesInDb: idSnapshot.size,
      filesOnDisk: dirents.length,
      bytesOnDisk,
      plannedDeleteCount: planned.length,
      plannedDeleteBytes: plannedBytes,
      actualDeleteCount: actualDeleted,
      actualDeleteBytes: actualBytes,
      scanDurationMs: Date.now() - startedAt
    }
  } catch (err) {
    return {
      outcome: 'failed',
      entriesInDb: 0,
      filesOnDisk: 0,
      bytesOnDisk: 0,
      plannedDeleteCount: 0,
      plannedDeleteBytes: 0,
      actualDeleteCount: 0,
      actualDeleteBytes: 0,
      scanDurationMs: Date.now() - startedAt,
      errorMessage: (err as Error).message
    }
  }
}

function pickAbortReason(args: {
  planned: number
  plannedBytes: number
  filesOnDisk: number
  bytesOnDisk: number
}): 'count-fraction' | 'byte-fraction' | undefined {
  const { planned, plannedBytes, filesOnDisk, bytesOnDisk } = args
  if (planned < SMALL_RESIDUE_COUNT_FLOOR && plannedBytes < SMALL_RESIDUE_BYTES_FLOOR) return undefined
  const countFraction = planned / Math.max(1, filesOnDisk)
  if (countFraction > ABORT_FRACTION) return 'count-fraction'
  const byteFraction = plannedBytes / Math.max(1, bytesOnDisk)
  if (byteFraction > ABORT_FRACTION) return 'byte-fraction'
  return undefined
}
