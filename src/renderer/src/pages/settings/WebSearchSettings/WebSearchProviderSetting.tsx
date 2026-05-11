import { Button, ButtonGroup, Flex, InfoTooltip, Input, Label, RowFlex, Tooltip } from '@cherrystudio/ui'
import {
  WEB_SEARCH_PROVIDER_CONFIG,
  webSearchProviderRequiresApiKey,
  webSearchProviderSupportsBasicAuth
} from '@renderer/config/webSearchProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLink, List } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingHelpLink,
  SettingHelpText,
  SettingHelpTextRow,
  SettingSubtitle,
  SettingTitle,
  SettingTitleExternalLink
} from '..'
import { WebSearchApiKeyListPopup } from './components/WebSearchApiKeyList'
import WebSearchProviderLogo from './components/WebSearchProviderLogo'
import { useWebSearchDefaultProviderAction } from './hooks/useWebSearchDefaultProviderAction'
import { useWebSearchProviderCheck } from './hooks/useWebSearchProviderCheck'
import { useWebSearchProviderForm } from './hooks/useWebSearchProviderForm'
import { getWebSearchProviderDescriptionKey, type WebSearchProviderMenuEntry } from './utils/webSearchProviderMeta'

interface Props {
  entry: WebSearchProviderMenuEntry
}

const WebSearchProviderSetting: FC<Props> = ({ entry }) => {
  const {
    defaultFetchUrlsProvider,
    defaultSearchKeywordsProvider: defaultProvider,
    setDefaultFetchUrlsProvider,
    setDefaultSearchKeywordsProvider,
    updateProvider
  } = useWebSearchProviders()
  const { capability, provider } = entry
  const { theme } = useTheme()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const providerForm = useWebSearchProviderForm(provider, updateProvider, capability)
  const providerCheck = useWebSearchProviderCheck({
    provider,
    capability,
    commitForm: providerForm.commitForm
  })
  const defaultAction = useWebSearchDefaultProviderAction(
    provider,
    capability,
    capability === 'fetchUrls' ? defaultFetchUrlsProvider : defaultProvider,
    capability === 'fetchUrls' ? setDefaultFetchUrlsProvider : setDefaultSearchKeywordsProvider
  )
  const webSearchProviderConfig = WEB_SEARCH_PROVIDER_CONFIG[provider.id]
  const apiKeyWebsite = webSearchProviderConfig?.websites?.apiKey
  const officialWebsite = webSearchProviderConfig?.websites?.official
  const needsApiKey = webSearchProviderRequiresApiKey(provider.id)
  const supportsBasicAuth = webSearchProviderSupportsBasicAuth(provider.id)
  const usesLlmProviderApiKey = provider.id === 'zhipu'
  const descriptionKey = getWebSearchProviderDescriptionKey(provider.id)
  const showApiKeyCheckButton = needsApiKey && !usesLlmProviderApiKey && providerCheck.canCheck
  const showApiHostCheckButton = !showApiKeyCheckButton && providerCheck.canCheck

  const openApiKeyList = async () => {
    await WebSearchApiKeyListPopup.show({
      providerId: provider.id,
      title: `${provider.name} ${t('settings.provider.api.key.list.title')}`
    })
  }

  const openLlmProviderSettings = () => {
    void navigate({ to: '/settings/provider', search: { id: provider.id } })
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>
          <Flex className="items-center justify-between" style={{ width: '100%' }}>
            <Flex className="items-center gap-2">
              <WebSearchProviderLogo providerId={provider.id} providerName={provider.name} size={20} />
              <span className="font-medium text-sm">{provider.name}</span>
              {officialWebsite && (
                <SettingTitleExternalLink href={officialWebsite}>
                  <ExternalLink size={12} />
                </SettingTitleExternalLink>
              )}
            </Flex>
            <Button variant="outline" disabled={!defaultAction.canSetAsDefault} onClick={defaultAction.onSetAsDefault}>
              {defaultAction.isDefault
                ? t('settings.tool.websearch.is_default')
                : t('settings.tool.websearch.set_as_default')}
            </Button>
          </Flex>
        </SettingTitle>
        <SettingHelpText className="mt-2">{t(descriptionKey)}</SettingHelpText>
        <SettingDivider style={{ width: '100%', margin: '10px 0' }} />

        {needsApiKey && usesLlmProviderApiKey && (
          <>
            <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
              {t('settings.provider.api_key.label')}
            </SettingSubtitle>
            <Button variant="outline" size="sm" onClick={openLlmProviderSettings}>
              <ExternalLink size={14} />
              {t('navigate.provider_settings')}
            </Button>
          </>
        )}

        {needsApiKey && !usesLlmProviderApiKey && (
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
                value={providerForm.apiKeyInput}
                placeholder={t('settings.provider.api_key.label')}
                onChange={(e) => providerForm.setApiKeyInput(e.target.value)}
                onBlur={providerForm.commitApiKeys}
                spellCheck={false}
                autoFocus={providerForm.apiKeys.length === 0}
                className="min-w-0 flex-1"
              />
              <Button
                variant="outline"
                className="h-9 shrink-0 px-3 shadow-none"
                disabled={providerCheck.checking}
                onClick={() => void providerCheck.checkProvider()}>
                {t('settings.tool.websearch.check')}
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

        {providerForm.apiHostCapabilities.map((providerCapability) => (
          <div key={providerCapability.feature}>
            <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
              {t('settings.provider.api_host')}
            </SettingSubtitle>
            <Flex className="gap-2">
              <Input
                value={providerForm.apiHosts[providerCapability.feature] ?? ''}
                placeholder={t('settings.provider.api_host')}
                onChange={(e) => providerForm.setApiHostInput(providerCapability.feature, e.target.value)}
                onBlur={() => providerForm.commitApiHost(providerCapability)}
              />
              {showApiHostCheckButton && (
                <Button
                  variant="outline"
                  className="h-9 shrink-0 px-3 shadow-none"
                  disabled={providerCheck.checking}
                  onClick={() => void providerCheck.checkProvider()}>
                  {t('settings.tool.websearch.check')}
                </Button>
              )}
            </Flex>
          </div>
        ))}

        {supportsBasicAuth && (
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
                <Label htmlFor="websearch-basic-auth-username">
                  {t('settings.provider.basic_auth.user_name.label')}
                </Label>
                <Input
                  id="websearch-basic-auth-username"
                  value={providerForm.basicAuthUsername}
                  placeholder={t('settings.provider.basic_auth.user_name.tip')}
                  onChange={(e) => providerForm.setBasicAuthUsername(e.target.value)}
                  onBlur={providerForm.commitBasicAuthUsername}
                />
              </div>
              {providerForm.basicAuthUsername && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="websearch-basic-auth-password">
                    {t('settings.provider.basic_auth.password.label')}
                  </Label>
                  <Input
                    id="websearch-basic-auth-password"
                    type="password"
                    value={providerForm.basicAuthPassword}
                    placeholder={t('settings.provider.basic_auth.password.tip')}
                    onChange={(e) => providerForm.setBasicAuthPassword(e.target.value)}
                    onBlur={providerForm.commitBasicAuthPassword}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </SettingGroup>
    </SettingContainer>
  )
}

export default WebSearchProviderSetting
