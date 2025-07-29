import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultOcrProvider, useOcrProviders } from '@renderer/hooks/useOcr'
import { PreprocessProvider } from '@renderer/types'
import { Select } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '../..'
import OcrProviderSettings from './OcrSettings'

const OcrSettings: FC = () => {
  const { ocrProviders } = useOcrProviders()
  const { provider: defaultProvider, setDefaultOcrProvider } = useDefaultOcrProvider()
  const { t } = useTranslation()
  const [selectedProvider, setSelectedProvider] = useState<PreprocessProvider | undefined>(defaultProvider)
  const { theme: themeMode } = useTheme()

  function updateSelectedOcrProvider(providerId: string) {
    const provider = ocrProviders.find((p) => p.id === providerId)
    if (!provider) {
      return
    }
    setDefaultOcrProvider(provider)
    setSelectedProvider(provider)
  }

  return (
    <SettingContainer theme={themeMode}>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('settings.tool.ocr.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tool.ocr.provider')}</SettingRowTitle>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Select
              value={selectedProvider?.id}
              style={{ width: '200px' }}
              onChange={(value: string) => updateSelectedOcrProvider(value)}
              placeholder={t('settings.tool.ocr.provider_placeholder')}
              options={ocrProviders.map((p) => ({
                value: p.id,
                label: p.name,
                disabled: !isMac && p.id === 'system' // 在非 Mac 系统下禁用 system 选项
              }))}
            />
          </div>
        </SettingRow>
      </SettingGroup>
      {selectedProvider && (
        <SettingGroup theme={themeMode}>
          <OcrProviderSettings provider={selectedProvider} />
        </SettingGroup>
      )}
    </SettingContainer>
  )
}
export default OcrSettings
