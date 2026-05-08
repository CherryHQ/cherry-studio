import { Badge, Flex } from '@cherrystudio/ui'
import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, isOcrOVProvider } from '@renderer/types'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

export const OcrOVSettings = () => {
  const { t } = useTranslation()
  const { provider } = useOcrProvider(BuiltinOcrProviderIds.ovocr)

  if (!isOcrOVProvider(provider)) {
    throw new Error('Not OV OCR provider.')
  }

  return (
    <>
      <SettingRow>
        <SettingRowTitle>
          <Flex className="items-center gap-4">{t('settings.tool.ocr.common.langs')}</Flex>
        </SettingRowTitle>
        <div className="flex gap-2">
          <Badge variant="secondary">🇬🇧 {t('languages.english')}</Badge>
          <Badge variant="secondary">🇨🇳 {t('languages.chinese')}</Badge>
          <Badge variant="secondary">🇭🇰 {t('languages.chinese-traditional')}</Badge>
        </div>
      </SettingRow>
    </>
  )
}
