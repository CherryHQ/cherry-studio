import { loggerService } from '@logger'
import { ErrorTag } from '@renderer/components/Tags/ErrorTag'
import { isMac, isWin } from '@renderer/config/constant'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, ImageOcrProvider, isImageOcrProvider, OcrProvider } from '@renderer/types'
import { Select } from 'antd'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

const logger = loggerService.withContext('OcrImageSettings')

type Props = {
  setProvider: (provider: OcrProvider) => void
}

const OcrImageSettings = ({ setProvider }: Props) => {
  const { t } = useTranslation()
  const { providers, imageProvider, getOcrProviderName, setImageProviderId } = useOcrProviders()

  const imageProviders = providers.filter((p) => isImageOcrProvider(p))

  // 挂载时更新外部状态
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
    const platformFilter = platformSupport ? () => true : (p: ImageOcrProvider) => p.id !== BuiltinOcrProviderIds.system
    return imageProviders.filter(platformFilter).map((p) => ({
      value: p.id,
      label: getOcrProviderName(p)
    }))
  }, [getOcrProviderName, imageProviders, platformSupport])

  const isSystem = imageProvider.id === BuiltinOcrProviderIds.system

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.ocr.image_provider')}</SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {!platformSupport && isSystem && <ErrorTag message={t('settings.tool.ocr.error.not_system')} />}
          <Select
            value={imageProvider.id}
            style={{ width: '200px' }}
            onChange={(id: string) => setImageProvider(id)}
            options={options}
          />
        </div>
      </SettingRow>
    </>
  )
}

export default OcrImageSettings
