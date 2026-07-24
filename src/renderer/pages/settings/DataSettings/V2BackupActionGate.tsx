import type { FC, PropsWithChildren } from 'react'

/**
 * Dual readiness flags for migrated Backup / Restore actions (Basic + Local).
 *
 * Unlike {@link BackupUnavailableGate} / `BACKUP_V2_READY` (shared by WebDAV /
 * S3 / Nutstore), these flags only control the live v2 action buttons. Flipping
 * or removing `BACKUP_V2_READY` is forbidden here — that would silently
 * re-enable v1 provider surfaces.
 *
 * Export and restore are **independent**:
 * - {@link isV2BackupExportReady} — packaged ON (export uses `createSnapshot` / VACUUM INTO into a detached backup.sqlite, no quiesce).
 * - {@link isV2BackupRestoreLiteReady} — packaged ON. Restore is a single entry:
 *   the archive's `manifest.preset` routes lite vs full internally (full-restore-plan §3);
 *   there is no separate Full gate.
 * - {@link isV2BackupRestoreReady} — any restore / LITE alias (kept for existing callers).
 *
 * Functions (not module consts) so tests can spy each flag without opening the other.
 */

/** Packaged export is production-ready once this gate ships. */
export function isV2BackupExportReady(): boolean {
  return true
}

/** Packaged LITE (DB-only) restore is production-ready. */
export function isV2BackupRestoreLiteReady(): boolean {
  return true
}

/** Any restore path ready (single entry — preset routing happens in the main process). */
export function isV2BackupRestoreReady(): boolean {
  return isV2BackupRestoreLiteReady()
}

type GateProps = PropsWithChildren<{
  /** Test override — production always uses the matching readiness function. */
  ready?: boolean
}>

/**
 * Export-only gate. Passthrough when export-ready; otherwise inert children.
 * Must not wrap restore controls — flipping export must not enable restore.
 */
export const V2BackupExportGate: FC<GateProps> = ({ children, ready = isV2BackupExportReady() }) => {
  if (ready) {
    return <>{children}</>
  }

  return (
    <div inert className="pointer-events-none select-none opacity-50">
      {children}
    </div>
  )
}

/**
 * Restore gate (single entry). Passthrough when restore-ready; otherwise inert.
 * Must not wrap export controls.
 */
export const V2BackupRestoreGate: FC<GateProps> = ({ children, ready = isV2BackupRestoreLiteReady() }) => {
  if (ready) {
    return <>{children}</>
  }

  return (
    <div inert className="pointer-events-none select-none opacity-50">
      {children}
    </div>
  )
}
