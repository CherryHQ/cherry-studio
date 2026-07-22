// Export-temp residue GC + live ownership marker (A6 / A8 ⑤).
//
// Crashed exports leave unredacted DB copies under `feature.backup.temp`
// (`{restoreId}.sqlite` [+ -wal/-shm] + `{restoreId}-stage/` + future shapes).
// Boot-time GC blanket-removes the dedicated temp root (same shape as
// `gcStagingResidue`), gated by live ownership markers so an in-flight export's
// entire tree is preserved.
//
// Ownership: ExportOrchestrator writes `{restoreId}.export-live` (pid stamp)
// before createSnapshot and clears it in finally. GC skips the whole root when
// ANY marker's pid is still alive (`process.kill(pid, 0)`).
//
// Safety: `application.getPath` for a directory key mkdirSync(recursive) on every
// call, so the next export recreates the root after blanket rm — no ENOENT.

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

function restoreIdFromLiveMarkerEntry(name: string): string | null {
  if (!name.endsWith(EXPORT_LIVE_MARKER_SUFFIX)) return null
  return name.slice(0, -EXPORT_LIVE_MARKER_SUFFIX.length) || null
}

/**
 * Blanket-remove the dedicated export temp root when no live export owns it.
 * Returns 1 when the root was removed, 0 when skipped / missing / unreadable.
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

  for (const name of entries) {
    const restoreId = restoreIdFromLiveMarkerEntry(name)
    if (!restoreId) continue
    if (isExportTempOwned(tempRoot, restoreId)) {
      logger.info('live export blocks blanket GC', { restoreId })
      return 0
    }
  }

  try {
    rmSync(tempRoot, { recursive: true, force: true })
  } catch (e) {
    // EACCES etc. — swallow so boot is never blocked by a stuck residue.
    logger.warn('export temp residue blanket GC failed', e as Error)
    return 0
  }
  logger.info('GC export temp residue: blanket-removed root')
  return 1
}
