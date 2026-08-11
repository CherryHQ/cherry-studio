import { useTabs } from '@renderer/hooks/tab'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export function useOpenReleaseNotes() {
  const { t } = useTranslation()
  const { openTab } = useTabs()

  return useCallback(() => {
    openTab('/app/release-notes', { title: t('settings.about.releases.title') })
  }, [openTab, t])
}
