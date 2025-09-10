import { isWin } from '@renderer/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function useFullScreenNotice() {
  const { t } = useTranslation()

  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(IpcChannel.FullscreenStatusChanged, (_, isFullscreen) => {
      if (isWin && isFullscreen) {
        window.toast.info({
          title: t('common.fullscreen'),
          timeout: 3000
        })
      }
    })

    return () => {
      cleanup()
    }
  }, [t])
}

export default useFullScreenNotice
