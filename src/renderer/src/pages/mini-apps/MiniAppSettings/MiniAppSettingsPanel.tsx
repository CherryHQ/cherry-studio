import { PageSidePanel } from '@cherrystudio/ui'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onClose: () => void
  /** Right-aligned actions in the header (e.g. Swap / Reset buttons). */
  headerActions?: ReactNode
  children?: ReactNode
}

/**
 * Display-settings drawer shell — title in the header + a slot for header
 * actions, body composed by the caller. Mirrors the `CodeToolDrawer` shape:
 * the panel owns the chrome, callers compose the body (`MiniAppListPair`,
 * `MiniAppDisplaySettings`).
 */
const MiniAppSettingsPanel: FC<Props> = ({ open, onClose, headerActions, children }) => {
  const { t } = useTranslation()

  const header = (
    <div className="flex w-full items-center gap-2">
      <span className="text-[12px] text-foreground">{t('settings.miniapps.display_title')}</span>
      {headerActions && <div className="ml-auto flex items-center gap-1">{headerActions}</div>}
    </div>
  )

  return (
    <PageSidePanel open={open} onClose={onClose} header={header} closeLabel={t('common.close')}>
      {children}
    </PageSidePanel>
  )
}

export default MiniAppSettingsPanel
