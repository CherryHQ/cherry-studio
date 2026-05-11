/**
 * Orphan sweep — Phase 1b.4 startup data-consistency pass.
 *
 * Two surfaces composed under one module:
 *
 * 1. **OrphanRefScanner** (DB-level, file-manager-architecture §7 Layer 3):
 *    walks `file_ref.sourceId` distinct values per sourceType, asks the
 *    corresponding `SourceTypeChecker` which ones still exist, deletes the
 *    rest. Adding a new `FileRefSourceType` without a checker is a compile
 *    error (Record<FileRefSourceType, SourceTypeChecker<...>>).
 *
 * 2. **runStartupFileSweep** (FS-level, file-manager-architecture §10):
 *    enumerates `{userData}/Data/Files/` for UUID-named files without a
 *    matching DB entry and abandoned `*.tmp-<uuid>` residue, applies the
 *    `mtime > 5min` heuristic and the safety threshold, then unlinks the
 *    survivors.
 *
 * Both surfaces emit a single structured log record per run via
 * `loggerService` — `orphan-sweep` for the DB pass (architecture §10.5
 * naming), `orphan-file-sweep` for the FS pass (disambiguates the two).
 *
 * ## Outcome shapes
 *
 * Reports use **discriminated unions on `outcome`** so illegal combinations
 * (e.g. `completed` with `abortReason`) cannot be constructed. Each branch
 * carries exactly the fields it needs:
 *
 * - `completed` — happy path
 * - `partial` — sweep completed but with non-fatal failures (per-type checker
 *   throw for DB sweep; non-ENOENT unlink errors for FS sweep)
 * - `aborted` — FS sweep refused to run because the safety threshold tripped
 * - `failed` — outer try/catch caught an unexpected throw
 *
 * Adding a new outcome variant + missing it in the dispatch site is a
 * compile error (`assertNever`).
 */

import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { FileEntryService } from '@data/services/FileEntryService'
import type { FileRefService } from '@data/services/FileRefService'
import type { OrphanCheckerRegistry } from '@data/services/orphan/FileRefCheckerRegistry'
import { loggerService } from '@logger'
import { allSourceTypes, type FileEntryId, type FileEntryOrigin, type FileRefSourceType } from '@shared/data/types/file'

const logger = loggerService.withContext('file/orphanSweep')

function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`)
}

// ─── DB-level: OrphanRefScanner ───

export interface OrphanRefScannerDeps {
  readonly fileRefService: Pick<FileRefService, 'listDistinctSourceIds' | 'cleanupBySourceBatch'>
  readonly registry: OrphanCheckerRegistry
}

export interface OrphanRefScanResult {
  /** Sum of successful per-sourceType deletions. */
  readonly total: number
  /**
   * Per-sourceType deletion counts. A sourceType is absent iff its checker
   * threw — see `errorsByType` for the failure message.
   */
  readonly byType: Partial<Record<FileRefSourceType, number>>
  /**
   * Per-sourceType error messages from any checker / cleanup throw. Empty
   * on a fully successful run.
   */
  readonly errorsByType: Partial<Record<FileRefSourceType, string>>
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

  /**
   * Run `scanOneType` against every registered sourceType, isolating
   * failures per-type so a transient checker throw doesn't poison the rest
   * of the sweep. Errors land in `errorsByType` and surface as `outcome:
   * 'partial'` at the umbrella level.
   */
  async scanAll(): Promise<OrphanRefScanResult> {
    const byType: Partial<Record<FileRefSourceType, number>> = {}
    const errorsByType: Partial<Record<FileRefSourceType, string>> = {}
    let total = 0
    for (const sourceType of allSourceTypes) {
      try {
        const removed = await this.scanOneType(sourceType)
        byType[sourceType] = removed
        total += removed
      } catch (err) {
        errorsByType[sourceType] = (err as Error).message
        logger.error('orphan-sweep-type-failed', { sourceType, err })
      }
    }
    return { total, byType, errorsByType }
  }
}

// ─── Orphan-entry report (no deletion — see file-manager-architecture §7.1) ───

export interface OrphanEntryReport {
  readonly total: number
  readonly byOrigin: Partial<Record<FileEntryOrigin, number>>
}

export interface ScanOrphanEntriesDeps {
  readonly fileEntryService: Pick<FileEntryService, 'findUnreferenced'>
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
  readonly fileEntryService: Pick<FileEntryService, 'findUnreferenced'>
  readonly fileRefService: Pick<FileRefService, 'listDistinctSourceIds' | 'cleanupBySourceBatch'>
  readonly registry: OrphanCheckerRegistry
}

interface DbSweepStats {
  readonly orphanRefsByType: Partial<Record<FileRefSourceType, number>>
  readonly orphanRefsTotal: number
  readonly orphanEntriesByOrigin: Partial<Record<FileEntryOrigin, number>>
  readonly orphanEntriesTotal: number
  readonly scanDurationMs: number
}

type DbSweepOutcome =
  | { readonly outcome: 'completed' }
  | {
      readonly outcome: 'partial'
      readonly errorsByType: Partial<Record<FileRefSourceType, string>>
    }
  | { readonly outcome: 'failed'; readonly errorMessage: string }

export type DbSweepReport = DbSweepStats & DbSweepOutcome

/**
 * Public shape consumed by `FileManager.getOrphanReport()` and the future
 * cleanup-UI consumer. Keeps the wire surface narrower than the full
 * `DbSweepReport` (e.g. omits `scanDurationMs`) while adding the run
 * timestamp the UI actually needs ("last scanned at HH:MM").
 */
export interface OrphanReport {
  readonly orphanRefsByType: Partial<Record<FileRefSourceType, number>>
  readonly orphanRefsTotal: number
  readonly orphanEntriesByOrigin: Partial<Record<FileEntryOrigin, number>>
  readonly orphanEntriesTotal: number
  /** ms epoch when the producing sweep settled; null before the first sweep. */
  readonly lastRunAt: number | null
}

/**
 * Run both DB-level passes (orphan refs + orphan-entry report) and emit a
 * single structured `orphan-sweep` log record. Per-sourceType failures are
 * isolated and surface as `outcome: 'partial'` with `errorsByType`; an
 * outer-level throw collapses to `outcome: 'failed'`. Caller decides
 * whether to fire-and-forget (FileManager does this in `onInit`).
 */
export async function runDbSweep(deps: RunDbSweepDeps): Promise<DbSweepReport> {
  const startedAt = Date.now()
  try {
    const scanner = new OrphanRefScanner({ fileRefService: deps.fileRefService, registry: deps.registry })
    const refs = await scanner.scanAll()
    const entries = await scanOrphanEntries({ fileEntryService: deps.fileEntryService })
    const stats: DbSweepStats = {
      orphanRefsByType: refs.byType,
      orphanRefsTotal: refs.total,
      orphanEntriesByOrigin: entries.byOrigin,
      orphanEntriesTotal: entries.total,
      scanDurationMs: Date.now() - startedAt
    }
    const hasErrors = Object.keys(refs.errorsByType).length > 0
    const report: DbSweepReport = hasErrors
      ? { ...stats, outcome: 'partial', errorsByType: refs.errorsByType }
      : { ...stats, outcome: 'completed' }
    logDbSweep(report)
    return report
  } catch (err) {
    const failed: DbSweepReport = {
      orphanRefsByType: {},
      orphanRefsTotal: 0,
      orphanEntriesByOrigin: {},
      orphanEntriesTotal: 0,
      scanDurationMs: Date.now() - startedAt,
      outcome: 'failed',
      errorMessage: (err as Error).message
    }
    logger.error('orphan-sweep', { event: 'orphan-sweep', ...failed })
    return failed
  }
}

function logDbSweep(report: DbSweepReport): void {
  const payload = { event: 'orphan-sweep', ...report }
  switch (report.outcome) {
    case 'completed':
      logger.info('orphan-sweep', payload)
      return
    case 'partial':
      logger.warn('orphan-sweep', payload)
      return
    case 'failed':
      logger.error('orphan-sweep', payload)
      return
    default:
      assertNever(report)
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

/** Cap how many failed-unlink samples we attach to the report (log-line size). */
const MAX_FAILED_SAMPLES = 5

export interface RunStartupFileSweepDeps {
  readonly fileEntryService: Pick<FileEntryService, 'listAllIds'>
  /** Test seam — defaults to `Date.now`. */
  readonly now?: () => number
}

interface FileSweepStats {
  readonly entriesInDb: number
  /** Total dirents enumerated, regardless of UUID/tmp candidacy. */
  readonly direntsScanned: number
  /** Candidates considered (UUID files + tmp residue) — backs the abort fraction math. */
  readonly filesOnDisk: number
  readonly bytesOnDisk: number
  readonly plannedDeleteCount: number
  readonly plannedDeleteBytes: number
  readonly actualDeleteCount: number
  readonly actualDeleteBytes: number
  /** Oldest mtime (ms epoch) among files actually unlinked this run; absent if none. */
  readonly oldestDeletedMtime?: number
  /** Non-ENOENT stat errors during planning — silent skips kept countable. */
  readonly statFailedCount: number
  readonly scanDurationMs: number
}

type FileSweepOutcome =
  | { readonly outcome: 'completed' }
  | {
      readonly outcome: 'partial'
      readonly failedDeleteCount: number
      readonly failedSamples: readonly string[]
    }
  | {
      readonly outcome: 'aborted'
      readonly abortReason: 'count-fraction' | 'byte-fraction'
    }
  | { readonly outcome: 'failed'; readonly errorMessage: string }

export type FileSweepReport = FileSweepStats & FileSweepOutcome

/**
 * Enumerate `{userData}/Data/Files/` and unlink:
 *   - UUID-named files whose id is not in the FileEntry snapshot
 *   - `*.tmp-<UUID>` atomic-write residue (including residue whose leading
 *     UUID still matches a live entry — e.g. crash mid-atomicWriteFile)
 *
 * `mtime > 5min` freshness gate (§10.3) defers anything in flight.
 * Plan-then-execute with the safety threshold (§10.4); aborts emit
 * `abortReason`. Per-file unlink failures are tolerated and surface as
 * `outcome: 'partial'` with `failedDeleteCount` + sample names.
 */
export async function runStartupFileSweep(deps: RunStartupFileSweepDeps): Promise<FileSweepReport> {
  const report = await runStartupFileSweepInner(deps)
  logFileSweep(report)
  return report
}

function logFileSweep(report: FileSweepReport): void {
  const payload = { event: 'orphan-file-sweep', ...report }
  switch (report.outcome) {
    case 'completed':
      logger.info('orphan-file-sweep', payload)
      return
    case 'partial':
      logger.warn('orphan-file-sweep', payload)
      return
    case 'aborted':
      logger.warn('orphan-file-sweep', payload)
      return
    case 'failed':
      logger.error('orphan-file-sweep', payload)
      return
    default:
      assertNever(report)
  }
}

interface CandidatePlan {
  readonly path: string
  readonly bytes: number
  readonly mtimeMs: number
}

async function runStartupFileSweepInner(deps: RunStartupFileSweepDeps): Promise<FileSweepReport> {
  const startedAt = Date.now()
  try {
    const filesDir = application.getPath('feature.files.data')
    const idSnapshot: Set<FileEntryId> = await deps.fileEntryService.listAllIds()

    let dirents: string[]
    try {
      dirents = await readdir(filesDir)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        // First-run / fresh install: feature.files.data is auto-ensured by
        // path-registry, so an ENOENT here usually means auto-mkdir failed
        // (warn-logged inside Application). Treat as "nothing to sweep".
        return emptyCompleted(idSnapshot.size, startedAt)
      }
      // Permission / I/O / wrong-type — surface as failure so the operator
      // (or future Sentry) sees a real signal, not a silent zero-count log.
      return {
        ...zeroStats(idSnapshot.size, startedAt),
        outcome: 'failed',
        errorMessage: `readdir ${filesDir}: ${(err as Error).message}`
      }
    }

    const now = (deps.now ?? Date.now)()
    const planned: CandidatePlan[] = []
    let candidatesCount = 0
    let candidatesBytes = 0
    let statFailedCount = 0
    for (const name of dirents) {
      const fullPath = path.join(filesDir, name)
      let st: Awaited<ReturnType<typeof stat>>
      try {
        st = await stat(fullPath)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          statFailedCount++
          logger.warn('orphan-file-sweep-stat-failed', { path: fullPath, code })
        }
        continue
      }
      // Skip directories / symlinks / sockets — only regular files are sweep
      // candidates. A UUID-named subdirectory should never exist but if it
      // does, attempting to unlink would just throw and silently succeed-fail
      // forever; explicit guard makes the contract clear.
      if (!st.isFile()) continue

      // Tmp residue MUST be checked first: atomicWriteFile produces names of
      // the form `<entryUUID>.<ext>.tmp-<randomUUID>` whose leading stem is
      // a live entry's UUID. `isUuidFileName` also matches the same stem, so
      // checking it first would mask the residue when the entry is in DB.
      const isCandidate =
        isTmpResidueName(name) ||
        (() => {
          const uuid = isUuidFileName(name)
          return Boolean(uuid && !idSnapshot.has(uuid.id))
        })()
      if (!isCandidate) continue
      candidatesCount++
      candidatesBytes += st.size
      if (now - st.mtimeMs <= FRESHNESS_GATE_MS) continue
      planned.push({ path: fullPath, bytes: st.size, mtimeMs: st.mtimeMs })
    }

    const plannedBytes = planned.reduce((s, p) => s + p.bytes, 0)
    const abortReason = pickAbortReason({
      planned: planned.length,
      plannedBytes,
      filesOnDisk: candidatesCount,
      bytesOnDisk: candidatesBytes
    })
    // Per architecture §10.4 the (count, bytes) floor is an absolute "small
    // residue is always fine" carve-out, so a 19-file 100%-of-disk plan is
    // intentionally allowed through. Surface it at warn-level so on-call has
    // a forensic breadcrumb when a user reports "Cherry deleted my files":
    // the fraction would otherwise have tripped the safety threshold.
    if (!abortReason && planned.length > 0) {
      const countFraction = planned.length / Math.max(1, candidatesCount)
      const byteFraction = plannedBytes / Math.max(1, candidatesBytes)
      if (countFraction > ABORT_FRACTION || byteFraction > ABORT_FRACTION) {
        logger.warn('orphan-file-sweep-below-floor', {
          event: 'orphan-file-sweep-below-floor',
          plannedCount: planned.length,
          plannedBytes,
          filesOnDisk: candidatesCount,
          bytesOnDisk: candidatesBytes,
          countFraction,
          byteFraction,
          smallResidueCountFloor: SMALL_RESIDUE_COUNT_FLOOR,
          smallResidueBytesFloor: SMALL_RESIDUE_BYTES_FLOOR
        })
      }
    }
    if (abortReason) {
      return {
        entriesInDb: idSnapshot.size,
        direntsScanned: dirents.length,
        filesOnDisk: candidatesCount,
        bytesOnDisk: candidatesBytes,
        plannedDeleteCount: planned.length,
        plannedDeleteBytes: plannedBytes,
        actualDeleteCount: 0,
        actualDeleteBytes: 0,
        statFailedCount,
        scanDurationMs: Date.now() - startedAt,
        outcome: 'aborted',
        abortReason
      }
    }

    let actualDeleted = 0
    let actualBytes = 0
    let failedDeleted = 0
    let oldestDeletedMtime: number | undefined
    const failedSamples: string[] = []
    for (const target of planned) {
      try {
        await unlink(target.path)
        actualDeleted++
        actualBytes += target.bytes
        if (oldestDeletedMtime === undefined || target.mtimeMs < oldestDeletedMtime) {
          oldestDeletedMtime = target.mtimeMs
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT') continue // genuinely fine — concurrent deletion
        failedDeleted++
        if (failedSamples.length < MAX_FAILED_SAMPLES) {
          failedSamples.push(`${path.basename(target.path)}: ${code ?? 'unknown'}`)
        }
        logger.warn('orphan-file-sweep-unlink-failed', { path: target.path, code })
      }
    }

    const stats: FileSweepStats = {
      entriesInDb: idSnapshot.size,
      direntsScanned: dirents.length,
      filesOnDisk: candidatesCount,
      bytesOnDisk: candidatesBytes,
      plannedDeleteCount: planned.length,
      plannedDeleteBytes: plannedBytes,
      actualDeleteCount: actualDeleted,
      actualDeleteBytes: actualBytes,
      oldestDeletedMtime,
      statFailedCount,
      scanDurationMs: Date.now() - startedAt
    }
    if (failedDeleted > 0) {
      return { ...stats, outcome: 'partial', failedDeleteCount: failedDeleted, failedSamples }
    }
    return { ...stats, outcome: 'completed' }
  } catch (err) {
    return {
      ...zeroStats(0, startedAt),
      outcome: 'failed',
      errorMessage: (err as Error).message
    }
  }
}

function emptyCompleted(entriesInDb: number, startedAt: number): FileSweepReport {
  return { ...zeroStats(entriesInDb, startedAt), outcome: 'completed' }
}

function zeroStats(entriesInDb: number, startedAt: number): FileSweepStats {
  return {
    entriesInDb,
    direntsScanned: 0,
    filesOnDisk: 0,
    bytesOnDisk: 0,
    plannedDeleteCount: 0,
    plannedDeleteBytes: 0,
    actualDeleteCount: 0,
    actualDeleteBytes: 0,
    statFailedCount: 0,
    scanDurationMs: Date.now() - startedAt
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
