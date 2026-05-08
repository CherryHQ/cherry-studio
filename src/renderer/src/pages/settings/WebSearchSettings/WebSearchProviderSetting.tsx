import { ExportOutlined } from '@ant-design/icons'
import { Button, Divider, Flex, InfoTooltip, Input, Label, RowFlex, Tooltip } from '@cherrystudio/ui'
import ApiKeyListPopup from '@renderer/components/Popups/ApiKeyListPopup/popup'
import {
  getWebSearchProviderLogo,
  WEB_SEARCH_PROVIDER_CONFIG,
  webSearchProviderRequiresApiKey,
  webSearchProviderSupportsBasicAuth
} from '@renderer/config/webSearchProviders'
import { useDefaultWebSearchProvider, useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import type { WebSearchProviderId } from '@renderer/types'
import { formatApiKeys } from '@renderer/utils'
import { getWebSearchProviderAvailability } from '@renderer/utils/webSearchProviders'
import type { WebSearchProviderFeatureCapability } from '@shared/data/presets/web-search-providers'
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

interface Props {
  providerId: WebSearchProviderId
}

const WebSearchProviderSetting: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider } = useWebSearchProvider(providerId)
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(provider.apiKey || '')
  const [apiHosts, setApiHosts] = useState<Record<string, string>>({})
  const [basicAuthUsername, setBasicAuthUsername] = useState(provider.basicAuthUsername || '')
  const [basicAuthPassword, setBasicAuthPassword] = useState(provider.basicAuthPassword || '')

  const webSearchProviderConfig = WEB_SEARCH_PROVIDER_CONFIG[provider.id]
  const apiKeyWebsite = webSearchProviderConfig?.websites?.apiKey
  const officialWebsite = webSearchProviderConfig?.websites?.official

  const onUpdateApiKey = () => {
    if (apiKey !== provider.apiKey) {
      void updateProvider({ apiKey })
    }
  }

  const onUpdateApiHost = (capability: WebSearchProviderFeatureCapability) => {
    let trimmedHost = apiHosts[capability.feature]?.trim() || ''
    if (trimmedHost.endsWith('/')) {
      trimmedHost = trimmedHost.slice(0, -1)
    }

    if (trimmedHost !== (capability.apiHost ?? '')) {
      void updateProvider({
        capabilities: provider.capabilities.map((item) =>
          item.feature === capability.feature ? { ...item, apiHost: trimmedHost } : item
        )
      })
    } else {
      setApiHosts((current) => ({ ...current, [capability.feature]: capability.apiHost ?? '' }))
    }
  }

  const onUpdateBasicAuthUsername = () => {
    const currentValue = basicAuthUsername || ''
    const savedValue = provider.basicAuthUsername || ''
    if (currentValue !== savedValue) {
      void updateProvider({ basicAuthUsername })
    } else {
      setBasicAuthUsername(provider.basicAuthUsername || '')
    }
  }

  const onUpdateBasicAuthPassword = () => {
    const currentValue = basicAuthPassword || ''
    const savedValue = provider.basicAuthPassword || ''
    if (currentValue !== savedValue) {
      void updateProvider({ basicAuthPassword })
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

  useEffect(() => {
    setApiKey(provider.apiKey ?? '')
    setApiHosts(
      Object.fromEntries(provider.capabilities.map((capability) => [capability.feature, capability.apiHost ?? '']))
    )
    setBasicAuthUsername(provider.basicAuthUsername ?? '')
    setBasicAuthPassword(provider.basicAuthPassword ?? '')
  }, [provider.apiKey, provider.capabilities, provider.basicAuthUsername, provider.basicAuthPassword])

  const providerLogo = getWebSearchProviderLogo(providerId)

  const isDefault = defaultProvider?.id === provider.id
  const needsApiKey = webSearchProviderRequiresApiKey(provider.id)
  const supportsBasicAuth = webSearchProviderSupportsBasicAuth(provider.id)
  const canSetAsDefault = !isDefault && getWebSearchProviderAvailability(provider, 'searchKeywords').available

  const handleSetAsDefault = () => {
    if (canSetAsDefault) {
      void setDefaultProvider(provider)
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
              <div className="h-5 w-5 rounded bg-(--color-background-subtle)" />
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
      {needsApiKey && (
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
          <div className="w-full">
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
          </div>
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
      {provider.capabilities.map((capability) => (
        <div key={capability.feature}>
          {capability.apiHost !== undefined && (
            <>
              <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
                {t(`settings.tool.websearch.capability.${capability.feature}`)}
              </SettingSubtitle>
              <Flex className="gap-2">
                <Input
                  value={apiHosts[capability.feature] ?? ''}
                  placeholder={t('settings.provider.api_host')}
                  onChange={(e) => setApiHosts((current) => ({ ...current, [capability.feature]: e.target.value }))}
                  onBlur={() => onUpdateApiHost(capability)}
                />
              </Flex>
            </>
          )}
        </div>
      ))}
      {provider.capabilities.length > 0 && (
        <>
          <SettingDivider style={{ marginTop: 12, marginBottom: 12 }} />
        </>
      )}
      {supportsBasicAuth && (
        <>
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
