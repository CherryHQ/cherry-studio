import { InfoTooltip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { getWebSearchProviderAvailability } from '@renderer/utils/webSearchProviders'
import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { useNavigate } from '@tanstack/react-router'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useWebSearchProviderLists } from '../hooks/useWebSearchProviderLists'
import { getUnavailableProviderDialogConfig } from '../utils/webSearchProviderMeta'
import { Field } from './Field'
import { SettingsSection } from './SettingsSection'
import { WebSearchProviderOption } from './WebSearchProviderOption'

const BasicSettings: FC = () => {
  const { t } = useTranslation()
  const {
    defaultSearchKeywordsProvider: defaultProvider,
    defaultFetchUrlsProvider,
    providers,
    keywordProviders,
    fetchUrlsProviders,
    setDefaultFetchUrlsProvider,
    setDefaultSearchKeywordsProvider
  } = useWebSearchProviderLists()
  const { maxResults, compressionConfig, setMaxResults } = useWebSearchSettings()
  const navigate = useNavigate()
  const [draftMaxResults, setDraftMaxResults] = useState(maxResults)

  useEffect(() => {
    setDraftMaxResults(maxResults)
  }, [maxResults])

  const openProviderSettings = (provider: ResolvedWebSearchProvider, missingReason: 'apiKey' | 'apiHost') => {
    window.modal.confirm({
      ...getUnavailableProviderDialogConfig(provider, t, missingReason),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: () => {
        void navigate({ to: '/settings/websearch' })
      }
    })
  }

  const updateSelectedWebSearchProvider = (
    providerId: string,
    capability: WebSearchCapability,
    updateProvider: (provider: ResolvedWebSearchProvider) => Promise<void>
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

  return (
    <>
      <SettingsSection title={t('settings.tool.websearch.search_provider')}>
        <Field label={t('settings.tool.websearch.default_provider')}>
          <Select
            value={defaultProvider?.id}
            onValueChange={(providerId) =>
              updateSelectedWebSearchProvider(providerId, 'searchKeywords', setDefaultSearchKeywordsProvider)
            }>
            <SelectTrigger className="h-7 w-full rounded-full bg-foreground/[0.06] text-xs leading-tight" size="sm">
              <SelectValue placeholder={t('settings.tool.websearch.search_provider_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {keywordProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  <WebSearchProviderOption provider={provider} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('settings.tool.websearch.fetch_urls_provider')}>
          <Select
            value={defaultFetchUrlsProvider?.id}
            onValueChange={(providerId) =>
              updateSelectedWebSearchProvider(providerId, 'fetchUrls', setDefaultFetchUrlsProvider)
            }>
            <SelectTrigger className="h-7 w-full rounded-full bg-foreground/[0.06] text-xs leading-tight" size="sm">
              <SelectValue placeholder={t('settings.tool.websearch.search_provider_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {fetchUrlsProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  <WebSearchProviderOption provider={provider} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </SettingsSection>

      <SettingsSection title={t('settings.general.label')}>
        <Field
          label={t('settings.tool.websearch.search_max_result.label')}
          help={
            maxResults > 20 &&
            compressionConfig?.method === 'none' && (
              <InfoTooltip
                content={t('settings.tool.websearch.search_max_result.tooltip')}
                iconProps={{ size: 10, color: 'currentColor', className: 'cursor-pointer text-muted-foreground/25' }}
              />
            )
          }>
          <div>
            <div className="mb-1.5 flex justify-end">
              <span className="font-semibold text-emerald-500 text-xs leading-tight">{draftMaxResults}</span>
            </div>
            <Slider
              value={[draftMaxResults]}
              className="w-full [&_[data-slot=slider-mark]]:text-foreground/30 [&_[data-slot=slider-mark]]:text-xs [&_[data-slot=slider-mark]]:leading-tight [&_[data-slot=slider-range]]:bg-emerald-500/60 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-emerald-500"
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
        </Field>
      </SettingsSection>
    </>
  )
}

export default BasicSettings
