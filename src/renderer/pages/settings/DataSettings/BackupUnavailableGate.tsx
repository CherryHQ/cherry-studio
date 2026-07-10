import { Alert } from '@cherrystudio/ui'
import type { FC, PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Temporary gate for the v1 backup surfaces.
 *
 * v2 backup & restore has not shipped yet, but every entry under Data Settings
 * still drives the v1 backup engine. To stop users from assuming the new backup
 * is already in place, we gray out and disable each v1 backup entry and show a
 * "coming soon" notice. Flip this to `true` (or remove the `BackupUnavailableGate`
 * usages) once v2 backup lands.
 */
export const BACKUP_V2_READY: boolean = false

const BackupUnavailableNotice: FC = () => {
  const { t } = useTranslation()
  return <Alert type="warning" showIcon message={t('settings.data.backup.v2_unavailable')} className="mb-3" />
}

/**
 * Wraps a v1 backup section. While v2 backup is unavailable it renders a notice
 * above the section and makes the wrapped controls non-interactive (`inert`,
 * which also drops them from tab order and the accessibility tree) and grayed
 * out. Once `BACKUP_V2_READY` is true it becomes a transparent passthrough.
 */
export const BackupUnavailableGate: FC<PropsWithChildren> = ({ children }) => {
  if (BACKUP_V2_READY) {
    return <>{children}</>
  }

  return (
    <>
      <BackupUnavailableNotice />
      <div inert className="pointer-events-none select-none opacity-50">
        {children}
      </div>
    </>
  )
}
