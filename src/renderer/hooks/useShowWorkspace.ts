import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useShowWorkspace')

export function useShowWorkspace() {
  const { t } = useTranslation()
  const [showWorkspace, setShowWorkspace] = usePreference('feature.notes.show_workspace')

  const updateShowWorkspace = useCallback(
    (show: boolean) => {
      void setShowWorkspace(show).catch((error) => {
        logger.error('Failed to update notes workspace visibility', error as Error)
        window.toast.error(t('notes.settings.save_failed'))
      })
    },
    [setShowWorkspace, t]
  )
  const toggleShowWorkspace = useCallback(() => {
    updateShowWorkspace(!showWorkspace)
  }, [showWorkspace, updateShowWorkspace])

  return {
    showWorkspace,
    setShowWorkspace: updateShowWorkspace,
    toggleShowWorkspace
  }
}
