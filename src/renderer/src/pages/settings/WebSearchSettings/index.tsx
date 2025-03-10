import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultWebSearchProvider, useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import { WebSearchProvider } from '@renderer/types'
import { Select } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'
import WebSearchProviderSetting from './WebSearchProviderSetting'

const WebSearchSettings: FC = () => {
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const { t } = useTranslation()
  const [selectedProvider, setSelectedProvider] = useState<WebSearchProvider | undefined>(defaultProvider)
  const { theme: themeMode } = useTheme()

  function updateSelectedWebSearchProvider(providerId: string) {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      return
    }
    setSelectedProvider(provider)
    setDefaultProvider(provider)
  }

  return (
    <SettingContainer theme={themeMode}>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('settings.websearch.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.websearch.search_provider')}</SettingRowTitle>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Select
              value={selectedProvider?.id}
              style={{ width: '200px' }}
              onChange={(value: string) => updateSelectedWebSearchProvider(value)}
              placeholder={t('settings.websearch.search_provider_placeholder')}
              options={providers.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={themeMode}>
        {selectedProvider && <WebSearchProviderSetting provider={selectedProvider} />}
      </SettingGroup>
      <BasicSettings />
      <BlacklistSettings />
    </SettingContainer>
  )
}
export default WebSearchSettings
