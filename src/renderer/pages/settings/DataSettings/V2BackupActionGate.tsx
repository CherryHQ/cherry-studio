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
 * - {@link isV2BackupRestoreReady} — stays inert until restore-quiesce; DEV-only
 *   so the restore spine can still be exercised in development.
 *
 * Functions (not module consts) so tests can spy each flag without opening the other.
 */

/** Packaged export is production-ready once this gate ships. */
export function isV2BackupExportReady(): boolean {
  return true
}

/** Restore stays fail-closed in packaged builds until restore-quiesce lands. */
export function isV2BackupRestoreReady(): boolean {
  return Boolean(import.meta.env.DEV)
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
 * Restore-only gate. Passthrough when restore-ready; otherwise inert children.
 * Must not wrap export controls — flipping restore must not enable export.
 */
export const V2BackupRestoreGate: FC<GateProps> = ({ children, ready = isV2BackupRestoreReady() }) => {
  if (ready) {
    return <>{children}</>
  }

  return (
    <div inert className="pointer-events-none select-none opacity-50">
      {children}
    </div>
  )
}
