// Export-temp residue GC + live ownership marker (review-M4 follow-up).
//
// Crashed exports leave unredacted DB copies under `feature.backup.temp`
// (`{restoreId}.sqlite` [+ -wal/-shm] + `{restoreId}-stage/`). Boot-time GC must
// clear those without deleting:
//   - arbitrary non-export files that happen to share the temp root
//   - an in-flight export's tree (service re-init / overlapping process)
//
// Ownership: ExportOrchestrator writes `{restoreId}.export-live` (pid stamp)
// before createSnapshot and clears it in finally. GC skips a restoreId when the
// marker's pid is still alive (`process.kill(pid, 0)`).

import { existsSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('exportTempResidue')

/** Sidecar marker next to `{restoreId}.sqlite` / `{restoreId}-stage`. */
export const EXPORT_LIVE_MARKER_SUFFIX = '.export-live' as const

export function exportLiveMarkerPath(tempRoot: string, restoreId: string): string {
  return join(tempRoot, `${restoreId}${EXPORT_LIVE_MARKER_SUFFIX}`)
}

/** Stamp this process as owning `restoreId`'s export temp tree. */
export function writeExportLiveMarker(tempRoot: string, restoreId: string, pid: number = process.pid): void {
  writeFileSync(exportLiveMarkerPath(tempRoot, restoreId), `${pid}\n`, 'utf8')
}

/** Best-effort clear; never throws (export finally must not fail the run). */
export function clearExportLiveMarker(tempRoot: string, restoreId: string): void {
  try {
    unlinkSync(exportLiveMarkerPath(tempRoot, restoreId))
  } catch {
    // ENOENT / EACCES — ignore
  }
}

/** True when `{restoreId}.export-live` names a still-running pid. */
export function isExportTempOwned(tempRoot: string, restoreId: string): boolean {
  const marker = exportLiveMarkerPath(tempRoot, restoreId)
  if (!existsSync(marker)) return false
  try {
    const pid = Number.parseInt(readFileSync(marker, 'utf8').trim(), 10)
    if (!Number.isFinite(pid) || pid <= 0) return false
    process.kill(pid, 0)
    return true
  } catch {
    // ESRCH / EPERM / unreadable marker → treat as not owned (safe to GC)
    return false
  }
}

/**
 * Map a top-level temp entry name → restoreId for known export residue shapes.
 * Returns null for unrelated files (must not be deleted).
 */
export function restoreIdFromExportTempEntry(name: string): string | null {
  if (name.endsWith('.sqlite-wal')) return name.slice(0, -'.sqlite-wal'.length) || null
  if (name.endsWith('.sqlite-shm')) return name.slice(0, -'.sqlite-shm'.length) || null
  if (name.endsWith('.sqlite')) return name.slice(0, -'.sqlite'.length) || null
  if (name.endsWith('-stage')) return name.slice(0, -'-stage'.length) || null
  if (name.endsWith(EXPORT_LIVE_MARKER_SUFFIX)) {
    return name.slice(0, -EXPORT_LIVE_MARKER_SUFFIX.length) || null
  }
  return null
}

function tryRemovePath(path: string, nameForLog: string): boolean {
  if (!existsSync(path)) return false
  try {
    rmSync(path, { recursive: true, force: true })
    return true
  } catch (e) {
    // EACCES etc. — swallow so boot is never blocked by a stuck residue.
    logger.warn('export temp residue GC entry failed', { name: nameForLog, err: e as Error })
    return false
  }
}

/**
 * Remove orphaned export temp entries under `tempRoot`.
 * Only clears known residue for a restoreId (`*.sqlite` + `-wal`/`-shm`,
 * `*-stage`, stale `.export-live`). Skips restoreIds with a live ownership
 * marker. Returns the number of top-level paths successfully removed.
 */
export function removeExportTempResidue(tempRoot: string): number {
  if (!existsSync(tempRoot)) return 0
  let entries: string[]
  try {
    entries = readdirSync(tempRoot)
  } catch (e) {
    logger.warn('export temp root unreadable during residue GC', e as Error)
    return 0
  }
  if (entries.length === 0) return 0

  const restoreIds = new Set<string>()
  for (const name of entries) {
    const id = restoreIdFromExportTempEntry(name)
    if (id) restoreIds.add(id)
  }
  if (restoreIds.size === 0) return 0

  let removed = 0
  for (const restoreId of restoreIds) {
    if (isExportTempOwned(tempRoot, restoreId)) {
      logger.info('export temp GC skipped live export', { restoreId })
      continue
    }
    const bundle = [
      `${restoreId}.sqlite`,
      `${restoreId}.sqlite-wal`,
      `${restoreId}.sqlite-shm`,
      `${restoreId}-stage`,
      `${restoreId}${EXPORT_LIVE_MARKER_SUFFIX}`
    ]
    let bundleRemoved = 0
    for (const name of bundle) {
      if (tryRemovePath(join(tempRoot, name), name)) bundleRemoved += 1
    }
    if (bundleRemoved > 0) {
      logger.info(`GC export temp residue: restoreId=${restoreId} removed=${bundleRemoved}`)
      removed += bundleRemoved
    }
  }
  return removed
}
