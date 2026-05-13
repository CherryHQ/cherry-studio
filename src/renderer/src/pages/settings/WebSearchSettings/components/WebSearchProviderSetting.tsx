import { Button, ButtonGroup, Flex, InfoTooltip, Input, Label, RowFlex, Tooltip } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { WebSearchBasicAuthPatch } from '@renderer/hooks/useWebSearch'
import { formatApiKeys, splitApiKeyString, withoutTrailingSlash } from '@renderer/utils/api'
import type {
  WebSearchCapability,
  WebSearchProvider,
  WebSearchProviderId,
  WebSearchProviderOverride,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLink, List } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
} from '../..'
import { useWebSearchPersist } from '../hooks/useWebSearchPersist'
import { useWebSearchProviderCheck } from '../hooks/useWebSearchProviderCheck'
import {
  getWebSearchProviderApiKeyWebsite,
  getWebSearchProviderDescriptionKey,
  getWebSearchProviderOfficialWebsite,
  type WebSearchProviderMenuEntry
} from '../utils/webSearchProviderMeta'
import { WebSearchApiKeyListPopup } from './WebSearchApiKeyList'
import WebSearchProviderLogo from './WebSearchProviderLogo'

type SetCapabilityApiHost = (
  providerId: WebSearchProviderId,
  capability: WebSearchCapability,
  apiHost: string
) => Promise<void>

interface Props {
  entry: WebSearchProviderMenuEntry
  defaultProvider?: WebSearchProvider
  providerOverrides: WebSearchProviderOverrides
  onSetApiKeys: (providerId: WebSearchProviderId, apiKeys: string[]) => Promise<void>
  onSetBasicAuth: (providerId: WebSearchProviderId, patch: WebSearchBasicAuthPatch) => Promise<void>
  onSetCapabilityApiHost: SetCapabilityApiHost
  onSetDefaultProvider: (provider: WebSearchProvider) => Promise<void>
  onUpdateProvider: (providerId: WebSearchProviderId, patch: WebSearchProviderOverride) => Promise<void>
}

function apiKeysToInput(apiKeys: readonly string[]): string {
  return apiKeys.join(', ')
}

function apiKeysToSignature(apiKeys: readonly string[]): string {
  return apiKeys.join('\n')
}

function normalizeApiKeysInput(value: string): string[] {
  return splitApiKeyString(formatApiKeys(value))
}

function normalizeApiHostInput(value: string): string {
  return withoutTrailingSlash(value.trim())
}

export const WebSearchProviderSetting: FC<Props> = ({
  defaultProvider,
  entry,
  onSetApiKeys,
  onSetBasicAuth,
  onSetCapabilityApiHost,
  onSetDefaultProvider,
  onUpdateProvider,
  providerOverrides
}) => {
  const { capability, provider } = entry
  const { theme } = useTheme()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const persist = useWebSearchPersist()
  const savedApiKeysInput = useMemo(() => apiKeysToInput(provider.apiKeys), [provider.apiKeys])
  const savedApiKeysSignature = useMemo(() => apiKeysToSignature(provider.apiKeys), [provider.apiKeys])
  const [apiKeysInput, setApiKeysInput] = useState(savedApiKeysInput)
  const [apiKeysBaseline, setApiKeysBaseline] = useState(savedApiKeysSignature)
  const apiKeysDraft = useMemo(() => normalizeApiKeysInput(apiKeysInput), [apiKeysInput])
  const apiKeysDraftSignature = useMemo(() => apiKeysToSignature(apiKeysDraft), [apiKeysDraft])
  const apiKeysDirty = apiKeysDraftSignature !== apiKeysBaseline

  const savedApiHost = entry.providerCapability.apiHost ?? ''
  const [apiHostInput, setApiHostInput] = useState(savedApiHost)
  const [apiHostBaseline, setApiHostBaseline] = useState(savedApiHost)
  const normalizedApiHostInput = useMemo(() => normalizeApiHostInput(apiHostInput), [apiHostInput])
  const apiHostDirty = normalizedApiHostInput !== apiHostBaseline

  const savedBasicAuthUsername = provider.basicAuthUsername || ''
  const savedBasicAuthPassword = provider.basicAuthPassword || ''
  const [basicAuthUsernameInput, setBasicAuthUsernameInput] = useState(savedBasicAuthUsername)
  const [basicAuthPasswordInput, setBasicAuthPasswordInput] = useState(savedBasicAuthPassword)
  const [basicAuthUsernameBaseline, setBasicAuthUsernameBaseline] = useState(savedBasicAuthUsername)
  const [basicAuthPasswordBaseline, setBasicAuthPasswordBaseline] = useState(savedBasicAuthPassword)
  const normalizedBasicAuthUsernameInput = basicAuthUsernameInput.trim()
  const normalizedBasicAuthPasswordInput = normalizedBasicAuthUsernameInput ? basicAuthPasswordInput.trim() : ''
  const basicAuthUsernameDirty = normalizedBasicAuthUsernameInput !== basicAuthUsernameBaseline
  const basicAuthPasswordDirty = normalizedBasicAuthPasswordInput !== basicAuthPasswordBaseline

  useEffect(() => {
    if (!apiKeysDirty) {
      setApiKeysInput(savedApiKeysInput)
    }
    setApiKeysBaseline(savedApiKeysSignature)
  }, [apiKeysDirty, savedApiKeysInput, savedApiKeysSignature])

  useEffect(() => {
    if (!apiHostDirty) {
      setApiHostInput(savedApiHost)
    }
    setApiHostBaseline(savedApiHost)
  }, [apiHostDirty, savedApiHost])

  useEffect(() => {
    if (!basicAuthUsernameDirty) {
      setBasicAuthUsernameInput(savedBasicAuthUsername)
    }
    setBasicAuthUsernameBaseline(savedBasicAuthUsername)
  }, [basicAuthUsernameDirty, savedBasicAuthUsername])

  useEffect(() => {
    if (!basicAuthPasswordDirty) {
      setBasicAuthPasswordInput(savedBasicAuthPassword)
    }
    setBasicAuthPasswordBaseline(savedBasicAuthPassword)
  }, [basicAuthPasswordDirty, savedBasicAuthPassword])

  const providerCheck = useWebSearchProviderCheck({
    provider,
    capability
  })
  const apiKeyWebsite = getWebSearchProviderApiKeyWebsite(provider.id)
  const officialWebsite = getWebSearchProviderOfficialWebsite(provider.id)
  const usesLlmProviderApiKey = provider.id === 'zhipu'
  const showApiKeySettings = provider.type === 'api' && provider.id !== 'fetch' && provider.id !== 'searxng'
  const supportsBasicAuth = provider.id === 'searxng'
  const descriptionKey = getWebSearchProviderDescriptionKey(provider.id)
  const showApiKeyCheckButton = showApiKeySettings && !usesLlmProviderApiKey && providerCheck.canCheck
  const showApiHostCheckButton = !showApiKeyCheckButton && providerCheck.canCheck
  const showApiHostSetting = entry.providerCapability.apiHost !== undefined
  const isDefault = defaultProvider?.id === provider.id

  const commitApiKeysDraft = useCallback(async () => {
    if (!apiKeysDirty) {
      return
    }

    await onSetApiKeys(provider.id, apiKeysDraft)
    setApiKeysInput(apiKeysToInput(apiKeysDraft))
    setApiKeysBaseline(apiKeysDraftSignature)
  }, [apiKeysDirty, apiKeysDraft, apiKeysDraftSignature, onSetApiKeys, provider.id])

  const commitApiHostDraft = useCallback(async () => {
    if (!showApiHostSetting || !apiHostDirty) {
      return
    }

    await onSetCapabilityApiHost(provider.id, capability, normalizedApiHostInput)
    setApiHostInput(normalizedApiHostInput)
    setApiHostBaseline(normalizedApiHostInput)
  }, [apiHostDirty, capability, normalizedApiHostInput, onSetCapabilityApiHost, provider.id, showApiHostSetting])

  const commitBasicAuthDraft = useCallback(async () => {
    if (!basicAuthUsernameDirty && !basicAuthPasswordDirty) {
      return
    }

    await onSetBasicAuth(provider.id, {
      username: normalizedBasicAuthUsernameInput,
      password: normalizedBasicAuthPasswordInput
    })
    setBasicAuthUsernameInput(normalizedBasicAuthUsernameInput)
    setBasicAuthPasswordInput(normalizedBasicAuthPasswordInput)
    setBasicAuthUsernameBaseline(normalizedBasicAuthUsernameInput)
    setBasicAuthPasswordBaseline(normalizedBasicAuthPasswordInput)
  }, [
    basicAuthPasswordDirty,
    basicAuthUsernameDirty,
    normalizedBasicAuthPasswordInput,
    normalizedBasicAuthUsernameInput,
    onSetBasicAuth,
    provider.id
  ])

  const commitDirtyDrafts = useCallback(async () => {
    const patch: WebSearchProviderOverride = {}

    if (apiKeysDirty) {
      patch.apiKeys = apiKeysDraft
    }

    if (showApiHostSetting && apiHostDirty) {
      patch.capabilities = {
        ...providerOverrides[provider.id]?.capabilities,
        [capability]: {
          ...providerOverrides[provider.id]?.capabilities?.[capability],
          apiHost: normalizedApiHostInput
        }
      }
    }

    if (basicAuthUsernameDirty || basicAuthPasswordDirty) {
      patch.basicAuthUsername = normalizedBasicAuthUsernameInput
      patch.basicAuthPassword = normalizedBasicAuthPasswordInput
    }

    if (Object.keys(patch).length === 0) {
      return
    }

    await onUpdateProvider(provider.id, patch)

    if (apiKeysDirty) {
      setApiKeysInput(apiKeysToInput(apiKeysDraft))
      setApiKeysBaseline(apiKeysDraftSignature)
    }
    if (showApiHostSetting && apiHostDirty) {
      setApiHostInput(normalizedApiHostInput)
      setApiHostBaseline(normalizedApiHostInput)
    }
    if (basicAuthUsernameDirty || basicAuthPasswordDirty) {
      setBasicAuthUsernameInput(normalizedBasicAuthUsernameInput)
      setBasicAuthPasswordInput(normalizedBasicAuthPasswordInput)
      setBasicAuthUsernameBaseline(normalizedBasicAuthUsernameInput)
      setBasicAuthPasswordBaseline(normalizedBasicAuthPasswordInput)
    }
  }, [
    apiHostDirty,
    apiKeysDirty,
    apiKeysDraft,
    apiKeysDraftSignature,
    basicAuthPasswordDirty,
    basicAuthUsernameDirty,
    capability,
    normalizedApiHostInput,
    normalizedBasicAuthPasswordInput,
    normalizedBasicAuthUsernameInput,
    onUpdateProvider,
    provider.id,
    providerOverrides,
    showApiHostSetting
  ])

  const openApiKeyList = async () => {
    const saved = await persist(commitApiKeysDraft, 'Failed to save web search API keys before opening list')
    if (!saved.ok) {
      return
    }

    await WebSearchApiKeyListPopup.show({
      providerId: provider.id,
      title: `${provider.name} ${t('settings.provider.api.key.list.title')}`
    })
  }

  const openLlmProviderSettings = () => {
    void navigate({ to: '/settings/provider', search: { id: provider.id } })
  }

  const checkProvider = async () => {
    const saved = await persist(commitDirtyDrafts, 'Failed to save web search provider before check')
    if (saved.ok) {
      await providerCheck.checkProvider()
    }
  }

  const setBasicAuthUsernameDraft = (value: string) => {
    setBasicAuthUsernameInput(value)
    if (!value.trim()) {
      setBasicAuthPasswordInput('')
    }
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
            <Button
              variant="outline"
              disabled={isDefault}
              onClick={() =>
                void persist(async () => {
                  if (!isDefault) {
                    await onSetDefaultProvider(provider)
                  }
                }, 'Failed to set default web search provider')
              }>
              {isDefault ? t('settings.tool.websearch.is_default') : t('settings.tool.websearch.set_as_default')}
            </Button>
          </Flex>
        </SettingTitle>
        <SettingHelpText className="mt-2">{t(descriptionKey)}</SettingHelpText>
        <SettingDivider style={{ width: '100%', margin: '10px 0' }} />

        {usesLlmProviderApiKey && (
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

        {showApiKeySettings && !usesLlmProviderApiKey && (
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
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('settings.provider.api.key.list.open')}
                  onClick={openApiKeyList}>
                  <List size={14} />
                </Button>
              </Tooltip>
            </SettingSubtitle>
            <ButtonGroup className="w-full">
              <Input
                type="password"
                value={apiKeysInput}
                placeholder={t('settings.provider.api_key.label')}
                onChange={(e) => setApiKeysInput(e.target.value)}
                onBlur={() => void persist(commitApiKeysDraft, 'Failed to save web search API keys')}
                spellCheck={false}
                autoFocus={provider.apiKeys.length === 0}
                className="min-w-0 flex-1"
              />
              <Button
                variant="outline"
                className="h-9 shrink-0 px-3 shadow-none"
                disabled={providerCheck.checking}
                onClick={() => void checkProvider()}>
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

        {showApiHostSetting && (
          <div>
            <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
              {t('settings.provider.api_host')}
            </SettingSubtitle>
            <Flex className="gap-2">
              <Input
                value={apiHostInput}
                placeholder={t('settings.provider.api_host')}
                onChange={(e) => setApiHostInput(e.target.value)}
                onBlur={() => void persist(commitApiHostDraft, 'Failed to save web search API host')}
              />
              {showApiHostCheckButton && (
                <Button
                  variant="outline"
                  className="h-9 shrink-0 px-3 shadow-none"
                  disabled={providerCheck.checking}
                  onClick={() => void checkProvider()}>
                  {t('settings.tool.websearch.check')}
                </Button>
              )}
            </Flex>
          </div>
        )}

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
                  value={basicAuthUsernameInput}
                  placeholder={t('settings.provider.basic_auth.user_name.tip')}
                  onChange={(e) => setBasicAuthUsernameDraft(e.target.value)}
                  onBlur={() => void persist(commitBasicAuthDraft, 'Failed to save web search basic auth username')}
                />
              </div>
              {basicAuthUsernameInput && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="websearch-basic-auth-password">
                    {t('settings.provider.basic_auth.password.label')}
                  </Label>
                  <Input
                    id="websearch-basic-auth-password"
                    type="password"
                    value={basicAuthPasswordInput}
                    placeholder={t('settings.provider.basic_auth.password.tip')}
                    onChange={(e) => setBasicAuthPasswordInput(e.target.value)}
                    onBlur={() => void persist(commitBasicAuthDraft, 'Failed to save web search basic auth password')}
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
