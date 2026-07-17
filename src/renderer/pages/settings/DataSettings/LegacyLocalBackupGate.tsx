import { Alert } from '@cherrystudio/ui'
import type { FC, PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Keeps Local Backup's v1 directory / auto-sync / manager / modal chain inert
 * while the migrated Backup/Restore actions use {@link V2BackupActionGate}.
 *
 * Must NOT share readiness with `BACKUP_V2_READY` — that constant is still the
 * legacy-provider gate for WebDAV / S3 / Nutstore.
 */
export const LegacyLocalBackupGate: FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation()

  return (
    <>
      <Alert type="warning" showIcon message={t('settings.data.backup.v2_unavailable')} className="mb-3" />
      <div inert className="pointer-events-none select-none opacity-50">
        {children}
      </div>
    </>
  )
}
