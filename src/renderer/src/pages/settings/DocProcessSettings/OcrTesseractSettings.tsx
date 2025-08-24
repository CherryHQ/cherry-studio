// import { loggerService } from '@logger'
import InfoTooltip from '@renderer/components/InfoTooltip'
import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, isOcrTesseractProvider } from '@renderer/types'
import { Flex, Select } from 'antd'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

// const logger = loggerService.withContext('OcrTesseractSettings')

export const OcrTesseractSettings = () => {
  const { t } = useTranslation()
  const { provider } = useOcrProvider(BuiltinOcrProviderIds.tesseract)

  if (!isOcrTesseractProvider(provider)) {
    throw new Error('Not tesseract provider.')
  }

  // const [langs, setLangs] = useState<OcrTesseractConfig['langs']>(provider.config?.langs ?? {})

  // currently static
  const options = [
    { value: 'chi_sim', label: t('languages.chinese') },
    { value: 'chi_tra', label: t('languages.chinese-traditional') },
    { value: 'eng', label: t('languages.english') }
  ]

  return (
    <>
      <SettingRow>
        <SettingRowTitle>
          <Flex align="center" gap={4}>
            {t('settings.tool.ocr.image.tesseract.langs')}
            <InfoTooltip title={t('settings.tool.ocr.image.tesseract.temp_tooltip')} />
          </Flex>
        </SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Select
            mode="multiple"
            disabled
            style={{ width: '100%' }}
            placeholder="Please select"
            value={['chi_sim', 'chi_tra', 'eng']}
            options={options}
          />
        </div>
      </SettingRow>
    </>
  )
}
