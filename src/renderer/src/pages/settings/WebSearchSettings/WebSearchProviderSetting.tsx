import { CheckOutlined, ExportOutlined, LoadingOutlined } from '@ant-design/icons'
import { Button, ButtonGroup, Divider, Flex, InfoTooltip, Input, Label, RowFlex, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import ApiKeyListPopup from '@renderer/components/Popups/ApiKeyListPopup/popup'
import { getWebSearchProviderLogo, WEB_SEARCH_PROVIDER_CONFIG } from '@renderer/config/webSearchProviders'
import { useTimer } from '@renderer/hooks/useTimer'
import { useDefaultWebSearchProvider, useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import { webSearchService } from '@renderer/services/WebSearchService'
import type { WebSearchProviderId } from '@renderer/types'
import { formatApiKeys, hasObjectKey } from '@renderer/utils'
import { List } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingDivider,
  SettingHelpLink,
  SettingHelpText,
  SettingHelpTextRow,
  SettingSubtitle,
  SettingTitle,
  SettingTitleExternalLink
} from '..'

const logger = loggerService.withContext('WebSearchProviderSetting')
interface Props {
  providerId: WebSearchProviderId
}

const WebSearchProviderSetting: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider } = useWebSearchProvider(providerId)
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(provider.apiKey || '')
  const [apiHost, setApiHost] = useState(provider.apiHost || '')
  const [apiChecking, setApiChecking] = useState(false)
  const [basicAuthUsername, setBasicAuthUsername] = useState(provider.basicAuthUsername || '')
  const [basicAuthPassword, setBasicAuthPassword] = useState(provider.basicAuthPassword || '')
  const [apiValid, setApiValid] = useState(false)
  const { setTimeoutTimer } = useTimer()

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
      title: `${provider.name} ${t('settings.provider.api.key.list.title')}`
    })
  }

  async function checkSearch() {
    if (!provider) {
      window.toast.error({
        title: t('settings.no_provider_selected'),
        timeout: 3000
      })
      return
    }

    if (apiKey.includes(',')) {
      await openApiKeyList()
      return
    }

    try {
      setApiChecking(true)
      const { valid, error } = await webSearchService.checkSearch(provider)

      const errorMessage = error && error?.message ? ' ' + error?.message : ''
      window.toast[valid ? 'success' : 'error']({
        timeout: valid ? 2000 : 8000,
        title: valid
          ? t('settings.tool.websearch.check_success')
          : t('settings.tool.websearch.check_failed') + errorMessage
      })

      setApiValid(valid)
    } catch (err) {
      logger.error('Check search error:', err as Error)
      setApiValid(false)
      window.toast.error({
        timeout: 8000,
        title: t('settings.tool.websearch.check_failed')
      })
    } finally {
      setApiChecking(false)
      setTimeoutTimer('checkSearch', () => setApiValid(false), 2500)
    }
  }

  useEffect(() => {
    setApiKey(provider.apiKey ?? '')
    setApiHost(provider.apiHost ?? '')
    setBasicAuthUsername(provider.basicAuthUsername ?? '')
    setBasicAuthPassword(provider.basicAuthPassword ?? '')
  }, [provider.apiKey, provider.apiHost, provider.basicAuthUsername, provider.basicAuthPassword])

  const providerLogo = getWebSearchProviderLogo(providerId)

  const isLocalProvider = provider.id.startsWith('local')

  const openLocalProviderSettings = async () => {
    if (officialWebsite) {
      await window.api.searchService.openSearchWindow(provider.id, true)
      await window.api.searchService.openUrlInSearchWindow(provider.id, officialWebsite)
    }
  }

  // Check if this provider is already the default
  const isDefault = defaultProvider?.id === provider.id

  // Check if provider needs API key but doesn't have one configured
  const needsApiKey = hasObjectKey(provider, 'apiKey')
  const hasApiKey = provider.apiKey && provider.apiKey.trim() !== ''
  const canSetAsDefault = !isDefault && (!needsApiKey || hasApiKey)

  const handleSetAsDefault = () => {
    if (canSetAsDefault) {
      setDefaultProvider(provider)
    }
  }

  return (
    <>
      <SettingTitle>
        <Flex className="items-center justify-between" style={{ width: '100%' }}>
          <Flex className="items-center gap-2">
            {providerLogo ? (
              <providerLogo.Avatar size={20} shape="rounded" />
            ) : (
              <div className="h-5 w-5 rounded bg-background-subtle" />
            )}
            <span className="font-medium text-sm">{provider.name}</span>
            {officialWebsite && webSearchProviderConfig?.websites && (
              <SettingTitleExternalLink href={webSearchProviderConfig.websites.official}>
                <ExportOutlined style={{ fontSize: '12px' }} />
              </SettingTitleExternalLink>
            )}
          </Flex>
          <Button variant="outline" disabled={!canSetAsDefault} onClick={handleSetAsDefault}>
            {isDefault ? t('settings.tool.websearch.is_default') : t('settings.tool.websearch.set_as_default')}
          </Button>
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      {isLocalProvider && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
            {t('settings.tool.websearch.local_provider.settings')}
          </SettingSubtitle>
          <Button variant="outline" onClick={openLocalProviderSettings}>
            <ExportOutlined />
            {t('settings.tool.websearch.local_provider.open_settings', { provider: provider.name })}
          </Button>
          <SettingHelpTextRow style={{ marginTop: 10 }}>
            <SettingHelpText>{t('settings.tool.websearch.local_provider.hint')}</SettingHelpText>
          </SettingHelpTextRow>
        </>
      )}
      {!isLocalProvider && hasObjectKey(provider, 'apiKey') && (
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
            <Tooltip content={t('settings.provider.api.key.list.open')} delay={500}>
              <Button variant="outline" size="icon-sm" onClick={openApiKeyList}>
                <List size={14} />
              </Button>
            </Tooltip>
          </SettingSubtitle>
          <ButtonGroup className="w-full">
            <Input
              type="password"
              value={apiKey}
              placeholder={t('settings.provider.api_key.label')}
              onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
              onBlur={onUpdateApiKey}
              spellCheck={false}
              autoFocus={apiKey === ''}
              className="min-w-0 flex-1"
            />
            <Button
              variant="outline"
              className="h-9 shrink-0 px-3 shadow-none"
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
          </ButtonGroup>
          <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
            <RowFlex>
              {apiKeyWebsite && (
                <SettingHelpLink target="_blank" href={apiKeyWebsite}>
                  {t('settings.provider.get_api_key')}
                </SettingHelpLink>
              )}
            </RowFlex>
            <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
          </SettingHelpTextRow>
        </>
      )}
      {!isLocalProvider && hasObjectKey(provider, 'apiHost') && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
            {t('settings.provider.api_host')}
          </SettingSubtitle>
          <Flex className="gap-2">
            <Input
              value={apiHost}
              placeholder={t('settings.provider.api_host')}
              onChange={(e) => setApiHost(e.target.value)}
              onBlur={onUpdateApiHost}
            />
          </Flex>
        </>
      )}
      {!isLocalProvider && hasObjectKey(provider, 'basicAuthUsername') && (
        <>
          <SettingDivider style={{ marginTop: 12, marginBottom: 12 }} />
          <SettingSubtitle
            style={{ marginTop: 5, marginBottom: 10, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
            {t('settings.provider.basic_auth.label')}
            <InfoTooltip
              placement="right"
              content={t('settings.provider.basic_auth.tip')}
              iconProps={{
                size: 16,
                color: 'var(--color-icon)',
                className: 'ml-1 cursor-pointer'
              }}
            />
          </SettingSubtitle>
          <div className="flex w-full flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="websearch-basic-auth-username">{t('settings.provider.basic_auth.user_name.label')}</Label>
              <Input
                id="websearch-basic-auth-username"
                value={basicAuthUsername}
                placeholder={t('settings.provider.basic_auth.user_name.tip')}
                onChange={(e) => setBasicAuthUsername(e.target.value)}
                onBlur={onUpdateBasicAuthUsername}
              />
            </div>
            {basicAuthUsername && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="websearch-basic-auth-password">
                  {t('settings.provider.basic_auth.password.label')}
                </Label>
                <Input
                  id="websearch-basic-auth-password"
                  type="password"
                  value={basicAuthPassword}
                  placeholder={t('settings.provider.basic_auth.password.tip')}
                  onChange={(e) => setBasicAuthPassword(e.target.value)}
                  onBlur={onUpdateBasicAuthPassword}
                />
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

export default WebSearchProviderSetting
