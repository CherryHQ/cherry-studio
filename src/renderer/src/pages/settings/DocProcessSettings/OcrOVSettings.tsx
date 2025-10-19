import { Flex } from '@cherrystudio/ui'
import { useOcrProvider } from '@renderer/hooks/ocr/useOcrProvider'
import { BuiltinOcrProviderIdMap, isOcrOVProvider } from '@renderer/types'
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

export const OcrOVSettings = () => {
  const { t } = useTranslation()
  const { provider } = useOcrProvider(BuiltinOcrProviderIdMap.ovocr)

  if (!isOcrOVProvider(provider)) {
    throw new Error('Not OV OCR provider.')
  }

  return (
    <>
      <SettingRow>
        <SettingRowTitle>
          <Flex className="items-center gap-4">{t('settings.tool.ocr.common.langs')}</Flex>
        </SettingRowTitle>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Tag>🇬🇧 {t('languages.english')}</Tag>
          <Tag>🇨🇳 {t('languages.chinese')}</Tag>
          <Tag>🇭🇰 {t('languages.chinese-traditional')}</Tag>
        </div>
      </SettingRow>
    </>
  )
}
