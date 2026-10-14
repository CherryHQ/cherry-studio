import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useTabsActions } from '@renderer/hooks/tab'

export function useOpenReleaseNotes() {
  const { t } = useTranslation()
  const { openTab } = useTabsActions()

  return useCallback(() => {
    openTab('/app/release-notes', { title: t('settings.about.releases.title') })
  }, [openTab, t])
}
