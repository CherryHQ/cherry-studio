import { CheckOutlined, ExportOutlined, InfoCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import { getWebSearchProviderLogo, WEB_SEARCH_PROVIDER_CONFIG } from '@renderer/config/webSearchProviders'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import { formatApiKeys } from '@renderer/services/ApiService'
import WebSearchService from '@renderer/services/WebSearchService'
import { WebSearchProvider } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { Avatar, Button, Divider, Flex, Input } from 'antd'
import Link from 'antd/es/typography/Link'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle, SettingTitle } from '..'
import ApiCheckPopup from '../ProviderSettings/ApiCheckPopup'

interface Props {
  provider: WebSearchProvider
}

const WebSearchProviderSetting: FC<Props> = ({ provider: _provider }) => {
  const { provider, updateProvider } = useWebSearchProvider(_provider.id)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(provider.apiKey || '')
  const [apiHost, setApiHost] = useState(provider.apiHost || '')
  const [apiChecking, setApiChecking] = useState(false)
  const [apiValid, setApiValid] = useState(false)

  const webSearchProviderConfig = WEB_SEARCH_PROVIDER_CONFIG[provider.id]
  const apiKeyWebsite = webSearchProviderConfig?.websites?.apiKey
  const officialWebsite = webSearchProviderConfig?.websites?.official

  const onUpdateApiKey = () => {
    if (apiKey !== provider.apiKey) {
      updateProvider({ ...provider, apiKey })
    }
  }

  const onUpdateApiHost = () => {
    let trimmedHost = apiHost?.trim() || ''
    if (trimmedHost.endsWith('/')) {
      trimmedHost = trimmedHost.slice(0, -1)
    }
    if (trimmedHost !== provider.apiHost) {
      updateProvider({ ...provider, apiHost: trimmedHost })
    } else {
      setApiHost(provider.apiHost || '')
    }
  }

  async function checkSearch() {
    if (!provider) {
      window.message.error({
        content: t('settings.websearch.no_provider_selected'),
        duration: 3,
        icon: <InfoCircleOutlined />,
        key: 'no-provider-selected'
      })
      return
    }

    if (apiKey.includes(',')) {
      const keys = apiKey
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k)

      const result = await ApiCheckPopup.show({
        title: t('settings.provider.check_multiple_keys'),
        provider: { ...provider, apiHost },
        apiKeys: keys,
        type: 'websearch'
      })

      if (result?.validKeys) {
        setApiKey(result.validKeys.join(','))
        updateProvider({ ...provider, apiKey: result.validKeys.join(',') })
      }
      return
    }

    try {
      setApiChecking(true)
      const { valid, error } = await WebSearchService.checkSearch(provider)

      const errorMessage = error && error?.message ? ' ' + error?.message : ''
      window.message[valid ? 'success' : 'error']({
        key: 'api-check',
        style: { marginTop: '3vh' },
        duration: valid ? 2 : 8,
        content: valid ? t('settings.websearch.check_success') : t('settings.websearch.check_failed') + errorMessage
      })

      setApiValid(valid)
    } catch (err) {
      console.error('Check search error:', err)
      setApiValid(false)
      window.message.error({
        key: 'check-search-error',
        style: { marginTop: '3vh' },
        duration: 8,
        content: t('settings.websearch.check_failed')
      })
    } finally {
      setApiChecking(false)
      setTimeout(() => setApiValid(false), 2500)
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
          <ProviderLogo shape="square" src={getWebSearchProviderLogo(provider.id)} size={16} />

          <ProviderName> {provider.name}</ProviderName>
          {officialWebsite && webSearchProviderConfig?.websites && (
            <Link target="_blank" href={webSearchProviderConfig.websites.official}>
              <ExportOutlined style={{ color: 'var(--color-text)', fontSize: '12px' }} />
            </Link>
          )}
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      {hasObjectKey(provider, 'apiKey') && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>{t('settings.provider.api_key')}</SettingSubtitle>
          <Flex gap={8}>
            <Input.Password
              value={apiKey}
              placeholder={t('settings.provider.api_key')}
              onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
              onBlur={onUpdateApiKey}
              spellCheck={false}
              type="password"
              autoFocus={apiKey === ''}
            />
            <Button
              ghost={apiValid}
              type={apiValid ? 'primary' : 'default'}
              onClick={checkSearch}
              disabled={apiChecking}>
              {apiChecking ? <LoadingOutlined spin /> : apiValid ? <CheckOutlined /> : t('settings.websearch.check')}
            </Button>
          </Flex>
          <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.websearch.get_api_key')}
            </SettingHelpLink>
            <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
          </SettingHelpTextRow>
        </>
      )}

      {hasObjectKey(provider, 'apiHost') && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
            {t('settings.provider.api_host')}
          </SettingSubtitle>
          <Flex>
            <Input
              value={apiHost}
              placeholder={t('settings.provider.api_host')}
              onChange={(e) => setApiHost(e.target.value)}
              onBlur={onUpdateApiHost}
            />
            <Button
              ghost={apiValid}
              type={apiValid ? 'primary' : 'default'}
              onClick={checkSearch}
              disabled={apiChecking}>
              {apiChecking ? <LoadingOutlined spin /> : apiValid ? <CheckOutlined /> : t('settings.websearch.check')}
            </Button>
          </Flex>
        </>
      )}
    </>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
`
const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`

export default WebSearchProviderSetting
