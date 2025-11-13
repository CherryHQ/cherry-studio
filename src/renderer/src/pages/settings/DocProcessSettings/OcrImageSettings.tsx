import { loggerService } from '@logger'
import { ErrorTag } from '@renderer/components/Tags/ErrorTag'
import { isMac, isWin } from '@renderer/config/constant'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import type { ImageOcrProvider, OcrProvider } from '@renderer/types'
import { BuiltinOcrProviderIds, isImageOcrProvider } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { Alert, Select, Skeleton } from 'antd'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRImmutable from 'swr/immutable'

import { SettingRow, SettingRowTitle } from '..'

const logger = loggerService.withContext('OcrImageSettings')

type Props = {
  setProvider: (provider: OcrProvider) => void
}

const OcrImageSettings = ({ setProvider }: Props) => {
  const { t } = useTranslation()
  const { providers, imageProvider, getOcrProviderName, setImageProviderId } = useOcrProviders()
  const fetcher = useCallback(() => {
    return window.api.ocr.listProviders()
  }, [])

  const { data: validProviders, isLoading, error } = useSWRImmutable('ocr/providers', fetcher)

  const imageProviders = providers.filter((p) => isImageOcrProvider(p))

  // 挂载时更新外部状态
  // FIXME: Just keep the imageProvider always valid, so we don't need update it in this component.
  useEffect(() => {
    setProvider(imageProvider)
  }, [imageProvider, setProvider])

  const setImageProvider = (id: string) => {
    const provider = imageProviders.find((p) => p.id === id)
    if (!provider) {
      logger.error(`Failed to find image provider by id: ${id}`)
      window.toast.error(t('settings.tool.ocr.image.error.provider_not_found'))
      return
    }

    setProvider(provider)
    setImageProviderId(id)
  }

  const platformSupport = isMac || isWin
  const options = useMemo(() => {
    if (!validProviders) return []
    const platformFilter = platformSupport ? () => true : (p: ImageOcrProvider) => p.id !== BuiltinOcrProviderIds.system
    const validFilter = (p: ImageOcrProvider) => validProviders.includes(p.id)
    return imageProviders
      .filter(platformFilter)
      .filter(validFilter)
      .map((p) => ({
        value: p.id,
        label: getOcrProviderName(p)
      }))
  }, [getOcrProviderName, imageProviders, platformSupport, validProviders])

  const isSystem = imageProvider.id === BuiltinOcrProviderIds.system

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.ocr.image_provider')}</SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {!platformSupport && isSystem && <ErrorTag message={t('settings.tool.ocr.error.not_system')} />}
          <OcrProviderSelector
            isLoading={isLoading}
            error={error}
            value={imageProvider.id}
            options={options}
            onChange={setImageProvider}
          />
        </div>
      </SettingRow>
    </>
  )
}

type OcrProviderSelectorProps = {
  isLoading: boolean
  error: any
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (id: string) => void
}

const OcrProviderSelector = ({ isLoading, error, value, options, onChange }: OcrProviderSelectorProps) => {
  const { t } = useTranslation()

  if (isLoading) {
    return <Skeleton.Input active style={{ width: '200px', height: '32px' }} />
  }

  if (error) {
    return <Alert type="error" message={t('ocr.error.provider.get_providers')} description={getErrorMessage(error)} />
  }

  return <Select value={value} style={{ width: '200px' }} onChange={onChange} options={options} />
}

export default OcrImageSettings
