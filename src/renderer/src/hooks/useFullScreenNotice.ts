import { isWindows } from '@renderer/config/constant'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { IpcChannel } from '@shared/IpcChannel'

export function useFullScreenNotice() {
  const { t } = useTranslation()

  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.FullscreenStatusChanged, (_, isFullscreen) => {
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
