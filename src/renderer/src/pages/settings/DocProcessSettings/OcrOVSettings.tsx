import { useOcrProvider } from '@renderer/hooks/useOcrProvider'
import { BuiltinOcrProviderIds, isOcrOVProvider } from '@renderer/types'
import { Flex, Tag } from 'antd'
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
          <Flex align="center" gap={4}>
            {t('settings.tool.ocr.common.langs')}
          </Flex>
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
