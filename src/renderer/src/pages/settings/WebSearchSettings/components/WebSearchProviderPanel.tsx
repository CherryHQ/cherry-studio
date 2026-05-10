import {
  webSearchProviderRequiresApiKey,
  webSearchProviderSupportsBasicAuth
} from '@renderer/config/webSearchProviders'
import type { WebSearchProviderUpdates } from '@renderer/utils/webSearchProviders'
import type { WebSearchCapability, WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchDefaultProviderAction } from '../hooks/useWebSearchDefaultProviderAction'
import { useWebSearchProviderForm } from '../hooks/useWebSearchProviderForm'
import { getWebSearchProviderDescriptionKey } from '../utils/webSearchProviderMeta'
import { WebSearchApiKeyListPopup } from './WebSearchApiKeyList'
import WebSearchProviderHeader from './WebSearchProviderHeader'
import {
  FreeProviderNotice,
  LlmProviderApiKeySection,
  ProviderApiHostSection,
  ProviderApiKeySection,
  ProviderBasicAuthSection,
  ProviderDefaultAction
} from './WebSearchProviderSections'

interface WebSearchProviderPanelProps {
  provider: ResolvedWebSearchProvider
  capability: WebSearchCapability
  defaultProvider: ResolvedWebSearchProvider | undefined
  setDefaultProvider: (provider: ResolvedWebSearchProvider) => Promise<void>
  updateProvider: (providerId: WebSearchProviderId, updates: WebSearchProviderUpdates) => Promise<void>
}

export const WebSearchProviderPanel: FC<WebSearchProviderPanelProps> = ({
  provider,
  capability,
  defaultProvider,
  setDefaultProvider,
  updateProvider
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const providerForm = useWebSearchProviderForm(provider, updateProvider, capability)
  const defaultAction = useWebSearchDefaultProviderAction(provider, capability, defaultProvider, setDefaultProvider)
  const needsApiKey = webSearchProviderRequiresApiKey(provider.id)
  const supportsBasicAuth = webSearchProviderSupportsBasicAuth(provider.id)
  const usesLlmProviderApiKey = provider.id === 'zhipu'

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
    <>
      <WebSearchProviderHeader
        providerId={provider.id}
        providerName={provider.name}
        description={t(getWebSearchProviderDescriptionKey(provider.id))}
        action={<ProviderDefaultAction {...defaultAction} />}
      />

      {needsApiKey && usesLlmProviderApiKey ? (
        <LlmProviderApiKeySection onOpenProviderSettings={openLlmProviderSettings} />
      ) : null}

      {needsApiKey && !usesLlmProviderApiKey ? (
        <ProviderApiKeySection
          provider={provider}
          apiKeys={providerForm.apiKeys}
          apiKeyInput={providerForm.apiKeyInput}
          onChange={providerForm.setApiKeyInput}
          onBlur={providerForm.commitApiKeys}
          onOpenApiKeyList={openApiKeyList}
        />
      ) : null}

      {providerForm.apiHostCapabilities.length > 0 ? (
        <ProviderApiHostSection
          apiHosts={providerForm.apiHosts}
          capabilities={providerForm.apiHostCapabilities}
          onChange={providerForm.setApiHostInput}
          onBlur={providerForm.commitApiHost}
        />
      ) : null}

      {supportsBasicAuth ? (
        <ProviderBasicAuthSection
          username={providerForm.basicAuthUsername}
          password={providerForm.basicAuthPassword}
          onUsernameChange={providerForm.setBasicAuthUsername}
          onPasswordChange={providerForm.setBasicAuthPassword}
          onUsernameBlur={providerForm.commitBasicAuthUsername}
          onPasswordBlur={providerForm.commitBasicAuthPassword}
        />
      ) : null}

      {!needsApiKey && providerForm.apiHostCapabilities.length === 0 && !supportsBasicAuth ? (
        <FreeProviderNotice />
      ) : null}
    </>
  )
}
