import { Alert } from '@cherrystudio/ui'
import type { FC, PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Keeps Local Backup's v1 directory / auto-sync / manager / modal chain inert
 * while the migrated Backup/Restore actions use
 * {@link isV2BackupExportReady} / {@link isV2BackupRestoreReady}.
 *
 * Must NOT share readiness with `BACKUP_V2_READY` — that constant is still the
 * legacy-provider gate for WebDAV / S3 / Nutstore.
 *
 * Notice copy is distinct from `v2_unavailable` so packaged builds do not show
 * two identical "V2 coming soon" alerts above the same page section.
 */
export const LegacyLocalBackupGate: FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation()

  return (
    <>
      <Alert type="warning" showIcon message={t('settings.data.backup.legacy_local_unavailable')} className="mb-3" />
      <div inert className="pointer-events-none select-none opacity-50">
        {children}
      </div>
    </>
  )
}
