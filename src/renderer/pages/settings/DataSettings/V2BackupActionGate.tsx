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
 * - {@link isV2BackupRestoreLiteReady} — packaged ON for DB-only / LITE restore (partial quiesce + IPC mutation gates).
 * - {@link isV2BackupRestoreFullReady} — packaged OFF while `stageFileResources` is the empty stub
 *   (`BackupService` DB-only restore). Flip when FileStager + `p1-dbonly-fileentry-blob` land.
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

/**
 * Packaged Full restore stays fail-closed while resource staging is stubbed.
 *
 * `BackupService.startRestore` still injects `stageFileResources: async () => []`
 * (DB-only / lite). Enabling Full before FileStager + `p1-dbonly-fileentry-blob`
 * would promote a DB whose file_entry / KB / Notes / skills blobs are missing
 * while the UI reports success. See packaged-full-restore-gate design §9.
 */
export function isV2BackupRestoreFullReady(): boolean {
  return false
}

/**
 * Any restore path ready (LITE today). Callers that mean Full must use
 * {@link isV2BackupRestoreFullReady} / {@link V2BackupRestoreFullGate}.
 */
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
 * LITE / any-restore gate. Passthrough when LITE restore-ready; otherwise inert.
 * Must not wrap export or Full-restore controls.
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

/**
 * Full-restore gate. Defaults fail-closed ({@link isV2BackupRestoreFullReady}).
 * Same inert shape as {@link V2BackupRestoreGate}; must wrap only Full controls.
 */
export const V2BackupRestoreFullGate: FC<GateProps> = ({ children, ready = isV2BackupRestoreFullReady() }) => {
  if (ready) {
    return <>{children}</>
  }

  return (
    <div inert className="pointer-events-none select-none opacity-50">
      {children}
    </div>
  )
}
