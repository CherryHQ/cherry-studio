import { CheckOutlined, InfoCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultWebSearchProvider, useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import { WebSearchProvider } from '@renderer/types'
import { Button, Select } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'
import WebSearchProviderSetting from './WebSearchProviderSetting'

const WebSearchSettings: FC = () => {
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider, setDefaultProvider, updateDefaultProvider } = useDefaultWebSearchProvider()

  const { t } = useTranslation()
  const [selectedProvider, setSelectedProvider] = useState<WebSearchProvider | undefined>(defaultProvider)
  const { theme: themeMode } = useTheme()

  const [apiChecking, setApiChecking] = useState(false)
  const [apiValid, setApiValid] = useState(false)

  function updateSelectedWebSearchProvider(providerId: string) {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      return
    }
    setApiValid(false)
    setSelectedProvider(provider)
    setDefaultProvider(provider)
  }
  async function checkSearch() {
    // 检查是否选择了提供商
    if (!selectedProvider || !selectedProvider.id) {
      window.message.error({
        content: t('settings.websearch.no_provider_selected'),
        duration: 3,
        icon: <InfoCircleOutlined />,
        key: 'no-provider-selected'
      })
      return
    }

    try {
      setApiChecking(true)
      const { valid, error } = await WebSearchService.checkSearch(selectedProvider)

      setApiValid(valid)

      // 如果验证失败且有错误信息，显示错误
      if (!valid && error) {
        const errorMessage = error.message ? ' ' + error.message : ''
        window.message.error({
          content: errorMessage,
          duration: 4,
          key: 'search-check-error'
        })
      }
      updateDefaultProvider({ ...selectedProvider, enabled: true })
    } catch (err) {
      console.error('Check search error:', err)
      setApiValid(false)
      window.message.error({
        content: t('settings.websearch.check_failed'),
        duration: 3,
        key: 'check-search-error'
      })
    } finally {
      setApiChecking(false)
    }
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
            <Button
              ghost={apiValid}
              type={apiValid ? 'primary' : 'default'}
              onClick={async () => await checkSearch()}
              disabled={apiChecking}>
              {apiChecking ? <LoadingOutlined spin /> : apiValid ? <CheckOutlined /> : t('settings.websearch.check')}
            </Button>
          </div>
        </SettingRow>
        <SettingDivider />
        {selectedProvider && <WebSearchProviderSetting provider={selectedProvider} />}
      </SettingGroup>
      <BasicSettings />
      <BlacklistSettings />
    </SettingContainer>
  )
}
export default WebSearchSettings
