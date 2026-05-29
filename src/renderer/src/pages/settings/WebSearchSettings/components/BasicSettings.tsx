import { InfoTooltip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '../..'
import { useWebSearchPersist } from '../hooks/useWebSearchPersist'
import { useWebSearchProviderLists } from '../hooks/useWebSearchProviderLists'
import { WebSearchProviderOption } from './WebSearchProviderOption'

const BasicSettings: FC = () => {
  const { theme } = useTheme()
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
  const [draftMaxResults, setDraftMaxResults] = useState(maxResults)
  const [maxResultsBaseline, setMaxResultsBaseline] = useState(maxResults)
  const maxResultsDirty = draftMaxResults !== maxResultsBaseline
  const persist = useWebSearchPersist()

  useEffect(() => {
    if (!maxResultsDirty) {
      setDraftMaxResults(maxResults)
    }
    setMaxResultsBaseline(maxResults)
  }, [maxResults, maxResultsDirty])

  const updateSelectedWebSearchProvider = (
    providerId: string,
    updateProvider: (provider: WebSearchProvider) => Promise<void>
  ) => {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      return
    }

    void persist(() => updateProvider(provider), 'Failed to save default web search provider')
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
              updateSelectedWebSearchProvider(providerId, setDefaultSearchKeywordsProvider)
            }>
            <SelectTrigger style={{ width: '200px' }}>
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
        </SettingRow>
        <SettingDivider />
        <SettingRow className="gap-8 py-2">
          <SettingRowTitle className="shrink-0">{t('settings.tool.websearch.fetch_urls_provider')}</SettingRowTitle>
          <Select
            value={defaultFetchUrlsProvider?.id}
            onValueChange={(providerId) => updateSelectedWebSearchProvider(providerId, setDefaultFetchUrlsProvider)}>
            <SelectTrigger style={{ width: '200px' }}>
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
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme} style={{ paddingBottom: 8 }}>
        <SettingTitle>{t('settings.general.label')}</SettingTitle>
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
              onValueCommit={(value) => {
                const nextMaxResults = value[0]

                void persist(() => setMaxResults(nextMaxResults), 'Failed to save web search max results').then(
                  (result) => {
                    if (result.ok) {
                      setDraftMaxResults(nextMaxResults)
                      setMaxResultsBaseline(nextMaxResults)
                    }
                  }
                )
              }}
            />
          </div>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

export default BasicSettings
