import { isWindows } from '@renderer/config/constant'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function useFullScreenNotice() {
  const { t } = useTranslation()

  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on('fullscreen-status-changed', (_, isFullscreen) => {
      if (isWindows && isFullscreen) {
        window.message.info({
          content: t('common.fullscreen'),
          duration: 3,
          key: 'fullscreen-notification'
        })
      }
    })

    return () => {
      cleanup()
    }
  }, [t])
}

export default useFullScreenNotice
