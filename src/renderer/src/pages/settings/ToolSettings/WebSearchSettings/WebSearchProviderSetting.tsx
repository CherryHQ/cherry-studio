import { CheckOutlined, ExportOutlined, LoadingOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import ApiKeyListPopup from '@renderer/components/Popups/ApiKeyListPopup/popup'
import { getWebSearchProviderLogo, WEB_SEARCH_PROVIDER_CONFIG } from '@renderer/config/webSearchProviders'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import { formatApiKeys, hasObjectKey } from '@renderer/utils'
import { Button, Divider, Flex, Form, Input, Space, Tooltip } from 'antd'
import Link from 'antd/es/typography/Link'
import { Info, List } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  SettingDivider,
  SettingHelpLink,
  SettingHelpText,
  SettingHelpTextRow,
  SettingSubtitle,
  SettingTitle
} from '../..'

const logger = loggerService.withContext('WebSearchProviderSetting')
interface Props {
  providerId: string
}

const WebSearchProviderSetting: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider } = useWebSearchProvider(providerId)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(provider.apiKey || '')
  const [apiHost, setApiHost] = useState(provider.apiHost || '')
  const [apiChecking, setApiChecking] = useState(false)
  const [basicAuthUsername, setBasicAuthUsername] = useState(provider.basicAuthUsername || '')
  const [basicAuthPassword, setBasicAuthPassword] = useState(provider.basicAuthPassword || '')
  const [apiValid, setApiValid] = useState(false)

  const webSearchProviderConfig = WEB_SEARCH_PROVIDER_CONFIG[provider.id]
  const apiKeyWebsite = webSearchProviderConfig?.websites?.apiKey
  const officialWebsite = webSearchProviderConfig?.websites?.official

  const onUpdateApiKey = () => {
    if (apiKey !== provider.apiKey) {
      updateProvider({ apiKey })
    }
  }

  const onUpdateApiHost = () => {
    let trimmedHost = apiHost?.trim() || ''
    if (trimmedHost.endsWith('/')) {
      trimmedHost = trimmedHost.slice(0, -1)
    }
    if (trimmedHost !== provider.apiHost) {
      updateProvider({ apiHost: trimmedHost })
    } else {
      setApiHost(provider.apiHost || '')
    }
  }

  const onUpdateBasicAuthUsername = () => {
    const currentValue = basicAuthUsername || ''
    const savedValue = provider.basicAuthUsername || ''
    if (currentValue !== savedValue) {
      updateProvider({ basicAuthUsername })
    } else {
      setBasicAuthUsername(provider.basicAuthUsername || '')
    }
  }

  const onUpdateBasicAuthPassword = () => {
    const currentValue = basicAuthPassword || ''
    const savedValue = provider.basicAuthPassword || ''
    if (currentValue !== savedValue) {
      updateProvider({ basicAuthPassword })
    } else {
      setBasicAuthPassword(provider.basicAuthPassword || '')
    }
  }

  const openApiKeyList = async () => {
    await ApiKeyListPopup.show({
      providerId: provider.id,
      providerKind: 'websearch',
      title: `${provider.name} ${t('settings.provider.api.key.list.title')}`
    })
  }

  async function checkSearch() {
    if (!provider) {
      window.message.error({
        content: t('settings.no_provider_selected'),
        duration: 3,
        icon: <Info size={18} />,
        key: 'no-provider-selected'
      })
      return
    }

    if (apiKey.includes(',')) {
      await openApiKeyList()
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
        content: valid
          ? t('settings.tool.websearch.check_success')
          : t('settings.tool.websearch.check_failed') + errorMessage
      })

      setApiValid(valid)
    } catch (err) {
      logger.error('Check search error:', err as Error)
      setApiValid(false)
      window.message.error({
        key: 'check-search-error',
        style: { marginTop: '3vh' },
        duration: 8,
        content: t('settings.tool.websearch.check_failed')
      })
    } finally {
      setApiChecking(false)
      setTimeout(() => setApiValid(false), 2500)
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
          <SettingSubtitle
            style={{
              marginTop: 5,
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
            {t('settings.provider.api_key.label')}
            <Tooltip title={t('settings.provider.api.key.list.open')} mouseEnterDelay={0.5}>
              <Button type="text" size="small" onClick={openApiKeyList} icon={<List size={14} />} />
            </Tooltip>
          </SettingSubtitle>
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password
              value={apiKey}
              placeholder={t('settings.provider.api_key.label')}
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
              {apiChecking ? (
                <LoadingOutlined spin />
              ) : apiValid ? (
                <CheckOutlined />
              ) : (
                t('settings.tool.websearch.check')
              )}
            </Button>
          </Space.Compact>
          <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.provider.api_key.tip')}
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
            {t('settings.provider.basic_auth.label')}
            <Tooltip title={t('settings.provider.basic_auth.tip')} placement="right">
              <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
            </Tooltip>
          </SettingSubtitle>
          <Flex>
            <Form
              layout="vertical"
              style={{ width: '100%' }}
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
              <Form.Item label={t('settings.provider.basic_auth.user_name.label')} name="username">
                <Input
                  placeholder={t('settings.provider.basic_auth.user_name.tip')}
                  onBlur={onUpdateBasicAuthUsername}
                />
              </Form.Item>
              <Form.Item
                label={t('settings.provider.basic_auth.password.label')}
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
