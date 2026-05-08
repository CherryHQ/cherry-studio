import { InfoTooltip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from '@cherrystudio/ui'
import { getWebSearchProviderLogo, webSearchProviderRequiresApiKey } from '@renderer/config/webSearchProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import {
  useDefaultFetchUrlsProvider,
  useDefaultWebSearchProvider,
  useWebSearchProviders,
  useWebSearchSettings
} from '@renderer/hooks/useWebSearchProviders'
import type { RendererWebSearchProvider } from '@renderer/utils/webSearchProviders'
import { getWebSearchProviderAvailability } from '@renderer/utils/webSearchProviders'
import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import { useNavigate } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

function getUnavailableProviderDialogConfig(
  provider: RendererWebSearchProvider,
  t: TFunction,
  missingReason: 'apiKey' | 'apiHost'
) {
  const missingFieldLabel =
    missingReason === 'apiKey' ? t('settings.tool.websearch.apikey') : t('settings.provider.api_host')

  return {
    title: t('settings.tool.websearch.search_provider'),
    content: `${provider.name} ${missingFieldLabel}`,
    okText: t('settings.tool.websearch.api_key_required.ok')
  }
}

const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const { provider: defaultFetchUrlsProvider, setDefaultProvider: setDefaultFetchUrlsProvider } =
    useDefaultFetchUrlsProvider()
  const { maxResults, compressionConfig, setMaxResults } = useWebSearchSettings()
  const navigate = useNavigate()
  const [draftMaxResults, setDraftMaxResults] = useState(maxResults)

  useEffect(() => {
    setDraftMaxResults(maxResults)
  }, [maxResults])

  const keywordProviders = providers.filter((provider) =>
    provider.capabilities.some((capability) => capability.feature === 'searchKeywords')
  )
  const fetchUrlsProviders = providers.filter((provider) =>
    provider.capabilities.some((capability) => capability.feature === 'fetchUrls')
  )

  const openProviderSettings = (provider: RendererWebSearchProvider, missingReason: 'apiKey' | 'apiHost') => {
    window.modal.confirm({
      ...getUnavailableProviderDialogConfig(provider, t, missingReason),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: () => {
        void navigate({ to: '/settings/websearch/provider/$providerId', params: { providerId: provider.id } })
      }
    })
  }

  const updateSelectedWebSearchProvider = (
    providerId: string,
    capability: WebSearchCapability,
    updateProvider: (provider: RendererWebSearchProvider) => Promise<void>
  ) => {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      return
    }

    const availability = getWebSearchProviderAvailability(provider, capability)
    if (!availability.available) {
      openProviderSettings(provider, availability.reason)
      return
    }

    void updateProvider(provider)
  }

  const renderProviderLabel = (provider: RendererWebSearchProvider) => {
    const logo = getWebSearchProviderLogo(provider.id)
    const needsApiKey = webSearchProviderRequiresApiKey(provider.id)

    return (
      <div className="flex items-center gap-2">
        {logo ? (
          <logo.Avatar size={16} shape="rounded" />
        ) : (
          <div className="h-4 w-4 rounded-sm bg-(--color-background-subtle)" />
        )}
        <span>
          {provider.name}
          {needsApiKey && ` (${t('settings.tool.websearch.apikey')})`}
        </span>
      </div>
    )
  }

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.tool.websearch.search_provider')}</SettingTitle>
        <SettingDivider />
        <SettingRow className="gap-8 py-2">
          <SettingRowTitle className="shrink-0">{t('settings.tool.websearch.default_provider')}</SettingRowTitle>
          <Select
            value={defaultProvider?.id}
            onValueChange={(providerId) =>
              updateSelectedWebSearchProvider(providerId, 'searchKeywords', setDefaultProvider)
            }>
            <SelectTrigger style={{ width: '200px' }}>
              <SelectValue placeholder={t('settings.tool.websearch.search_provider_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {keywordProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {renderProviderLabel(provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingDivider />
        <SettingRow className="gap-8 py-2">
          <SettingRowTitle className="shrink-0">{t('settings.tool.websearch.fetch_urls_provider')}</SettingRowTitle>
          <Select
            value={defaultFetchUrlsProvider?.id}
            onValueChange={(providerId) =>
              updateSelectedWebSearchProvider(providerId, 'fetchUrls', setDefaultFetchUrlsProvider)
            }>
            <SelectTrigger style={{ width: '200px' }}>
              <SelectValue placeholder={t('settings.tool.websearch.search_provider_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {fetchUrlsProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {renderProviderLabel(provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme} style={{ paddingBottom: 8 }}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow className="items-start gap-8">
          <SettingRowTitle className="mt-2 min-w-32 shrink-0">
            {t('settings.tool.websearch.search_max_result.label')}
            {maxResults > 20 && compressionConfig?.method === 'none' && (
              <InfoTooltip
                content={t('settings.tool.websearch.search_max_result.tooltip')}
                iconProps={{ size: 16, color: 'var(--color-icon)', className: 'ml-1 cursor-pointer' }}
              />
            )}
          </SettingRowTitle>
          <div className="-mb-2 mt-3 w-full max-w-xl">
            <Slider
              value={[draftMaxResults]}
              className="w-full"
              min={1}
              max={100}
              step={1}
              marks={[
                { value: 1, label: '1' },
                { value: 5, label: '5' },
                { value: 20, label: '20' },
                { value: 50, label: '50' },
                { value: 100, label: '100' }
              ]}
              onValueChange={(value) => setDraftMaxResults(value[0])}
              onValueCommit={(value) => void setMaxResults(value[0])}
            />
          </div>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

export default BasicSettings
