import { isWin } from '@renderer/config/constant'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function useFullScreenNotice() {
  const { t } = useTranslation()

  useEffect(() => {
    const unsubscribe = window.api.windowManager.onFullscreenChange((isFullscreen) => {
      if (isWin && isFullscreen) {
        window.toast.info({
          title: t('common.fullscreen'),
          timeout: 3000
        })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [t])
}

export default useFullScreenNotice
