import { isWin } from '@renderer/config/constant'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { useTranslation } from 'react-i18next'

export function useFullScreenNotice() {
  const { t } = useTranslation()

  useIpcOn('window.fullscreen_changed', (isFullscreen) => {
    if (isWin && isFullscreen) {
      window.toast.info({
        title: t('common.fullscreen'),
        timeout: 3000
      })
    }
  })
}

export default useFullScreenNotice
