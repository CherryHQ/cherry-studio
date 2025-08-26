import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { useAppSelector } from '@renderer/store'
import { setImageOcrProvider } from '@renderer/store/ocr'
import { BuiltinOcrProviderIds, ImageOcrProvider, isImageOcrProvider, OcrProvider } from '@renderer/types'
import { Select } from 'antd'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'

import { SettingRow, SettingRowTitle } from '..'

const logger = loggerService.withContext('OcrImageSettings')

type Props = {
  setProvider: (provider: OcrProvider) => void
}

const OcrImageSettings = ({ setProvider }: Props) => {
  const { t } = useTranslation()
  const providers = useAppSelector((state) => state.ocr.providers)
  const imageProvider = useAppSelector((state) => state.ocr.imageProvider)
  const imageProviders = providers.filter((p) => isImageOcrProvider(p))
  const dispatch = useDispatch()

  // 挂载时更新外部状态
  useEffect(() => {
    setProvider(imageProvider)
  }, [imageProvider, setProvider])

  const updateImageProvider = (id: string) => {
    const provider = imageProviders.find((p) => p.id === id)
    if (!provider) {
      logger.error(`Failed to find image provider by id: ${id}`)
      window.message.error(t('settings.tool.ocr.image.error.provider_not_found'))
      return
    }

    setProvider(provider)
    dispatch(setImageOcrProvider(provider))
  }

  const options = useMemo(() => {
    const platformFilter = isMac ? () => true : (p: ImageOcrProvider) => p.id !== BuiltinOcrProviderIds.mac
    return imageProviders.filter(platformFilter).map((p) => ({
      value: p.id,
      label: p.name
    }))
  }, [imageProviders])

  return (
    <>
      <SettingRow>
        <SettingRowTitle>{t('settings.tool.ocr.image_provider')}</SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Select
            value={imageProvider.id}
            style={{ width: '200px' }}
            onChange={(id: string) => updateImageProvider(id)}
            options={options}
          />
        </div>
      </SettingRow>
    </>
  )
}

export default OcrImageSettings
