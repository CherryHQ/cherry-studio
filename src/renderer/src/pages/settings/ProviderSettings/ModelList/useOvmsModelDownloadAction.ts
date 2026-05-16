import { useProvider } from '@renderer/hooks/useProvider'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import DownloadOVMSModelPopup from './DownloadOVMSModelPopup'

export function useOvmsModelDownloadAction(providerId: string) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)

  const openOvmsModelDownload = useCallback(() => {
    if (provider) {
      void DownloadOVMSModelPopup.show({ title: t('ovms.download.title'), provider })
    }
  }, [provider, t])

  return {
    openOvmsModelDownload
  }
}
