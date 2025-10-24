import { Skeleton } from '@cherrystudio/ui'
import { Alert } from '@heroui/react'
import { ErrorTag } from '@renderer/components/Tags/ErrorTag'
import { isMac, isWin } from '@renderer/config/constant'
import { useOcrImageProvider } from '@renderer/hooks/ocr/useOcrImageProvider'
import { useOcrProviders } from '@renderer/hooks/ocr/useOcrProviders'
import { BuiltinOcrProviderIdMap, isImageOcrProvider } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { Select } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

// const logger = loggerService.withContext('OcrImageSettings')

const OcrImageSettings = () => {
  const { t } = useTranslation()
  const { providers, loading, error, getOcrProviderName } = useOcrProviders({ registered: true })
  const { imageProvider, setImageProviderId, imageProviderId } = useOcrImageProvider()

  const imageProviders = useMemo(() => providers?.filter((p) => isImageOcrProvider(p)) ?? [], [providers])

  const setImageProvider = useCallback(
    (id: string) => {
      setImageProviderId(id)
    },
    [setImageProviderId]
  )

  const platformSupport = isMac || isWin
  const options = useMemo(() => {
    return imageProviders.map((p) => ({
      value: p.id,
      label: getOcrProviderName(p)
    }))
  }, [getOcrProviderName, imageProviders])

  const isSystem = imageProvider?.id === BuiltinOcrProviderIdMap.system

  const content = useMemo(() => {
    if (loading) {
      return <Skeleton className="h-full w-50" />
    }

    if (error) {
      return (
        <Alert
          color="danger"
          title={t('ocr.provider.get.error.failed', { provider: imageProviderId })}
          description={getErrorMessage(error)}
        />
      )
    }

    if (!imageProvider) {
      return <Alert color="danger" title={t('ocr.error.provider.not_found')} />
    }

    return (
      <>
        {!platformSupport && isSystem && <ErrorTag message={t('settings.tool.ocr.error.not_system')} />}
        {!loading && !error && (
          <Select
            value={imageProvider.id}
            className="w-50"
            onChange={(id: string) => setImageProvider(id)}
            options={options}
          />
        )}
        {!loading && error && (
          <Alert color="danger" title={t('ocr.error.provider.get_providers')} description={getErrorMessage(error)} />
        )}
      </>
    )
  }, [error, imageProvider, imageProviderId, isSystem, loading, options, platformSupport, setImageProvider, t])

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.ocr.image_provider')}</SettingRowTitle>
        <div className="flex items-center gap-2 self-stretch">{content}</div>
      </SettingRow>
    </>
  )
}

export default OcrImageSettings
