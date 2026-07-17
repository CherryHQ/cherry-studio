import { Alert } from '@cherrystudio/ui'
import type { FC, PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Scoped gate for the four migrated Backup/Restore actions (Basic + Local).
 *
 * Unlike {@link BackupUnavailableGate} / `BACKUP_V2_READY` (shared by WebDAV /
 * S3 / Nutstore), this gate only wraps the live v2 action buttons. Flipping or
 * removing `BACKUP_V2_READY` is forbidden here — that would silently re-enable
 * v1 provider surfaces.
 *
 * BackupService refuses packaged builds (`onInit` early-return + restore reject).
 * Match that fail-closed contract: only expose actions in DEV; otherwise inert.
 *
 * Function (not module const) so tests can spy packaged vs DEV readiness.
 */
export function isV2BackupActionsReady(): boolean {
  return Boolean(import.meta.env.DEV)
}

/** @deprecated Prefer {@link isV2BackupActionsReady} — kept for call-site clarity. */
export const V2_BACKUP_ACTIONS_READY: boolean = import.meta.env.DEV

const V2BackupActionsUnavailableNotice: FC = () => {
  const { t } = useTranslation()
  return <Alert type="warning" showIcon message={t('settings.data.backup.v2_unavailable')} className="mb-3" />
}

type GateProps = PropsWithChildren<{
  /** Test override — production always uses {@link isV2BackupActionsReady}. */
  ready?: boolean
}>

export const V2BackupActionGate: FC<GateProps> = ({ children, ready = isV2BackupActionsReady() }) => {
  if (ready) {
    return <>{children}</>
  }

  return (
    <>
      <V2BackupActionsUnavailableNotice />
      <div inert className="pointer-events-none select-none opacity-50">
        {children}
      </div>
    </>
  )
}
