import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultPreprocessProvider, usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import { PreprocessProvider } from '@renderer/types'
import { Select } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '../..'
import PreprocessProviderSettings from './PreprocessSettings'

const PreprocessSettings: FC = () => {
  const { preprocessProviders } = usePreprocessProviders()
  const { provider: defaultProvider, setDefaultPreprocessProvider } = useDefaultPreprocessProvider()
  const { t } = useTranslation()
  const [selectedProvider, setSelectedProvider] = useState<PreprocessProvider | undefined>(defaultProvider)
  const { theme: themeMode } = useTheme()

  function updateSelectedPreprocessProvider(providerId: string) {
    const provider = preprocessProviders.find((p) => p.id === providerId)
    if (!provider) {
      return
    }
    setDefaultPreprocessProvider(provider)
    setSelectedProvider(provider)
  }

  return (
    <SettingContainer theme={themeMode}>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('settings.tool.preprocess.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tool.preprocess.provider')}</SettingRowTitle>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Select
              value={selectedProvider?.id}
              style={{ width: '200px' }}
              onChange={(value: string) => updateSelectedPreprocessProvider(value)}
              placeholder={t('settings.tool.preprocess.provider_placeholder')}
              options={preprocessProviders.map((p) => ({
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
          <PreprocessProviderSettings provider={selectedProvider} />
        </SettingGroup>
      )}
    </SettingContainer>
  )
}
export default PreprocessSettings
