import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultWebSearchProvider, useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import { WebSearchProvider } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '../..'
import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'
import CompressionSettings from './CompressionSettings'
import WebSearchProviderSetting from './WebSearchProviderSetting'

const WebSearchSettings: FC = () => {
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const { t } = useTranslation()
  const [selectedProvider, setSelectedProvider] = useState<WebSearchProvider | undefined>(defaultProvider)
  const { theme: themeMode } = useTheme()

  const isLocalProvider = selectedProvider?.id.startsWith('local')

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
        <SettingTitle>{t('settings.tool.websearch.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tool.websearch.search_provider')}</SettingRowTitle>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Selector
              size={14}
              value={selectedProvider?.id}
              onChange={(value: string) => updateSelectedWebSearchProvider(value)}
              placeholder={t('settings.tool.websearch.search_provider_placeholder')}
              options={providers.map((p) => ({
                value: p.id,
                label: `${p.name} (${hasObjectKey(p, 'apiKey') ? t('settings.tool.websearch.apikey') : t('settings.tool.websearch.free')})`
              }))}
            />
          </div>
        </SettingRow>
      </SettingGroup>
      {!isLocalProvider && (
        <SettingGroup theme={themeMode}>
          {selectedProvider && <WebSearchProviderSetting providerId={selectedProvider.id} />}
        </SettingGroup>
      )}
      <BasicSettings />
      <CompressionSettings />
      <BlacklistSettings />
    </SettingContainer>
  )
}
export default WebSearchSettings
