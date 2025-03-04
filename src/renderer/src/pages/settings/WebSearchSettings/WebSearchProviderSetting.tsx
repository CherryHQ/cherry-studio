import { ExportOutlined } from '@ant-design/icons'
import { WEB_SEARCH_PROVIDER_CONFIG } from '@renderer/config/webSearchProviders'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import { WebSearchProvider } from '@renderer/types'
import { Divider, Flex, Input } from 'antd'
import Link from 'antd/es/typography/Link'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingHelpLink, SettingHelpTextRow, SettingSubtitle, SettingTitle } from '..'

interface Props {
  provider: WebSearchProvider
}
const WebSearchProviderSetting: FC<Props> = ({ provider: _provider }) => {
  const { provider, updateProvider } = useWebSearchProvider(_provider.id)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(provider.apiKey)
  const [apiHost, setApiHost] = useState(provider.apiHost)

  const webSearchProviderConfig = WEB_SEARCH_PROVIDER_CONFIG[provider.id]
  const apiKeyWebsite = webSearchProviderConfig?.websites?.apiKey
  const officialWebsite = webSearchProviderConfig?.websites?.official
  const onUpdateApiKey = () => {
    if (apiKey !== provider.apiKey) {
      updateProvider({ ...provider, apiKey })
    }
  }

  const onUpdateApiHost = () => {
    const trimmedHost = apiHost?.trim() || ''
    if (trimmedHost !== provider.apiHost) {
      updateProvider({ ...provider, apiHost: trimmedHost })
    } else {
      setApiHost(provider.apiHost || '')
    }
  }

  useEffect(() => {
    setApiKey(provider.apiKey ?? '')
    setApiHost(provider.apiHost ?? '')
  }, [provider.apiKey, provider.apiHost])

  return (
    <>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ProviderName> {provider.name}</ProviderName>
          {officialWebsite && webSearchProviderConfig?.websites && (
            <Link target="_blank" href={webSearchProviderConfig.websites.official}>
              <ExportOutlined style={{ color: 'var(--color-text)', fontSize: '12px' }} />
            </Link>
          )}
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      {provider.apiKey !== undefined && (
        <>
          <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.api_key')}</SettingSubtitle>
          <Input.Password
            value={apiKey}
            placeholder={t('settings.provider.api_key')}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={onUpdateApiKey}
            spellCheck={false}
            type="password"
            autoFocus={apiKey === ''}
          />
          <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.websearch.get_api_key')}
            </SettingHelpLink>
          </SettingHelpTextRow>
        </>
      )}
      {provider.apiHost !== undefined && (
        <>
          <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.api_host')}</SettingSubtitle>
          <Input
            value={apiHost}
            placeholder={t('settings.provider.api_host')}
            onChange={(e) => setApiHost(e.target.value)}
            onBlur={onUpdateApiHost}
          />
        </>
      )}
    </>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

export default WebSearchProviderSetting
