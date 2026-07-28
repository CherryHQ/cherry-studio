import { Alert } from '@cherrystudio/ui'
import type { FC, PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Compatibility gate for the v1 backup surfaces.
 *
 * The retained v1 engine is active again and its direct archive now includes
 * the v2 SQLite database and cache.json. Keep the wrapper as a transparent
 * passthrough until the settings surfaces move to the future v2 engine.
 */
export const BACKUP_V1_ENABLED: boolean = true

const BackupUnavailableNotice: FC = () => {
  const { t } = useTranslation()
  return <Alert type="warning" showIcon message={t('settings.data.backup.v2_unavailable')} className="mb-3" />
}

/**
 * Wraps a v1 backup section. When the compatibility engine is disabled it
 * renders a notice above the section and makes the wrapped controls
 * non-interactive (`inert`, which also drops them from tab order and the
 * accessibility tree) and grayed out. While the retained v1 engine is enabled
 * it becomes a transparent passthrough.
 */
export const BackupUnavailableGate: FC<PropsWithChildren> = ({ children }) => {
  if (BACKUP_V1_ENABLED) {
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
