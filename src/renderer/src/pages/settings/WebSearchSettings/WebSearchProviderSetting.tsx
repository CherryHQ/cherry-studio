import { ExportOutlined } from '@ant-design/icons'
import { getWebSearchProviderLogo, WEB_SEARCH_PROVIDER_CONFIG } from '@renderer/config/webSearchProviders'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import { WebSearchProvider } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { Divider, Flex, Form, Input, Tooltip } from 'antd'
import Link from 'antd/es/typography/Link'
import { Info } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDivider, SettingHelpLink, SettingHelpTextRow, SettingSubtitle, SettingTitle } from '..'
import ApiKeyList from '../ProviderSettings/ApiKeyList'

interface Props {
  provider: WebSearchProvider
}

const WebSearchProviderSetting: FC<Props> = ({ provider: _provider }) => {
  const { provider, updateProvider } = useWebSearchProvider(_provider.id)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(provider.apiKey || '')
  const [apiHost, setApiHost] = useState(provider.apiHost || '')
  const [basicAuthUsername, setBasicAuthUsername] = useState(provider.basicAuthUsername || '')
  const [basicAuthPassword, setBasicAuthPassword] = useState(provider.basicAuthPassword || '')

  const webSearchProviderConfig = WEB_SEARCH_PROVIDER_CONFIG[provider.id]
  const apiKeyWebsite = webSearchProviderConfig?.websites?.apiKey
  const officialWebsite = webSearchProviderConfig?.websites?.official

  const handleApiKeyChange = (newApiKey: string) => {
    setApiKey(newApiKey)
    updateProvider({ ...provider, apiKey: newApiKey })
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

  const onUpdateBasicAuthUsername = () => {
    const currentValue = basicAuthUsername || ''
    const savedValue = provider.basicAuthUsername || ''
    if (currentValue !== savedValue) {
      updateProvider({ ...provider, basicAuthUsername: basicAuthUsername })
    } else {
      setBasicAuthUsername(provider.basicAuthUsername || '')
    }
  }

  const onUpdateBasicAuthPassword = () => {
    const currentValue = basicAuthPassword || ''
    const savedValue = provider.basicAuthPassword || ''
    if (currentValue !== savedValue) {
      updateProvider({ ...provider, basicAuthPassword: basicAuthPassword })
    } else {
      setBasicAuthPassword(provider.basicAuthPassword || '')
    }
  }

  useEffect(() => {
    setApiKey(provider.apiKey ?? '')
    setApiHost(provider.apiHost ?? '')
    setBasicAuthUsername(provider.basicAuthUsername ?? '')
    setBasicAuthPassword(provider.basicAuthPassword ?? '')
  }, [provider.apiKey, provider.apiHost, provider.basicAuthUsername, provider.basicAuthPassword])

  return (
    <>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ProviderLogo src={getWebSearchProviderLogo(provider.id)} />
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
          <ApiKeyList provider={provider} apiKeys={apiKey} onChange={handleApiKeyChange} type="websearch" />
          {apiKeyWebsite && (
            <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
              <SettingHelpLink target="_blank" href={apiKeyWebsite}>
                {t('settings.websearch.get_api_key')}
              </SettingHelpLink>
            </SettingHelpTextRow>
          )}
        </>
      )}
      {hasObjectKey(provider, 'apiHost') && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
            {t('settings.provider.api_host')}
          </SettingSubtitle>
          <Flex gap={8}>
            <Input
              value={apiHost}
              placeholder={t('settings.provider.api_host')}
              onChange={(e) => setApiHost(e.target.value)}
              onBlur={onUpdateApiHost}
            />
          </Flex>
        </>
      )}
      {hasObjectKey(provider, 'basicAuthUsername') && (
        <>
          <SettingDivider style={{ marginTop: 12, marginBottom: 12 }} />
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
            {t('settings.provider.basic_auth')}
            <Tooltip title={t('settings.provider.basic_auth.tip')} placement="right">
              <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
            </Tooltip>
          </SettingSubtitle>
          <Flex>
            <Form
              layout="inline"
              initialValues={{
                username: basicAuthUsername,
                password: basicAuthPassword
              }}
              onValuesChange={(changedValues) => {
                // Update local state when form values change
                if ('username' in changedValues) {
                  setBasicAuthUsername(changedValues.username || '')
                }
                if ('password' in changedValues) {
                  setBasicAuthPassword(changedValues.password || '')
                }
              }}>
              <Form.Item label={t('settings.provider.basic_auth.user_name')} name="username">
                <Input
                  placeholder={t('settings.provider.basic_auth.user_name.tip')}
                  onBlur={onUpdateBasicAuthUsername}
                />
              </Form.Item>
              <Form.Item
                label={t('settings.provider.basic_auth.password')}
                name="password"
                rules={[{ required: !!basicAuthUsername, validateTrigger: ['onBlur', 'onChange'] }]}
                help=""
                hidden={!basicAuthUsername}>
                <Input.Password
                  placeholder={t('settings.provider.basic_auth.password.tip')}
                  onBlur={onUpdateBasicAuthPassword}
                  disabled={!basicAuthUsername}
                  visibilityToggle={true}
                />
              </Form.Item>
            </Form>
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
const ProviderLogo = styled.img`
  width: 20px;
  height: 20px;
  object-fit: contain;
`

export default WebSearchProviderSetting
