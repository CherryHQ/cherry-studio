import { PageSidePanel } from '@cherrystudio/ui'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onClose: () => void
  children?: ReactNode
}

/**
 * Display-settings drawer shell — owns the chrome (title + close button); the
 * body is composed by the caller from the "display management" and
 * "preferences" groups.
 */
const MiniAppSettingsPanel: FC<Props> = ({ open, onClose, children }) => {
  const { t } = useTranslation()

  return (
    <PageSidePanel
      open={open}
      onClose={onClose}
      header={<span className="font-semibold text-base text-foreground">{t('settings.miniApps.display_title')}</span>}
      closeLabel={t('common.close')}>
      {children}
    </PageSidePanel>
  )
}

export default MiniAppSettingsPanel
