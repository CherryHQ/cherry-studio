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

import type { FileRefService } from '@data/services/FileRefService'
import type { OrphanCheckerRegistry } from '@data/services/orphan/FileRefCheckerRegistry'
import type { FileRefSourceType } from '@shared/data/types/file'

import type { FileManagerDeps } from './deps'

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

// ─── FS-level: runStartupFileSweep (Group D — landing in subsequent commits) ───

export type FileManagerDepsForSweep = FileManagerDeps
