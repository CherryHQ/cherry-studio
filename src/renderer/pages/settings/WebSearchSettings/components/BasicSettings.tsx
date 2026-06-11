import {
  Button,
  InfoTooltip,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip
} from '@cherrystudio/ui'
import { ResetIcon } from '@renderer/components/Icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '../..'
import { useWebSearchPersist } from '../hooks/useWebSearchPersist'
import { useWebSearchProviderLists } from '../hooks/useWebSearchProviderLists'
import CompressionSettings from './CompressionSettings'
import { WebSearchProviderOption } from './WebSearchProviderOption'

const settingRowClassName = 'items-center justify-between gap-6 py-1'
const settingLabelClassName = 'min-w-0 flex-1'
const selectTriggerClassName = 'h-8 w-56 text-sm'
const DEFAULT_MAX_RESULTS = 5

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
  const [draftMaxResultsInput, setDraftMaxResultsInput] = useState(String(maxResults))
  const [maxResultsBaseline, setMaxResultsBaseline] = useState(maxResults)
  const maxResultsDirty = draftMaxResultsInput !== String(maxResultsBaseline)
  const isMaxResultsDefault =
    maxResultsBaseline === DEFAULT_MAX_RESULTS && draftMaxResultsInput === String(DEFAULT_MAX_RESULTS)
  const persist = useWebSearchPersist()

  useEffect(() => {
    if (!maxResultsDirty) {
      setDraftMaxResultsInput(String(maxResults))
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

  const commitMaxResultsDraft = () => {
    if (!maxResultsDirty) {
      return
    }

    const parsedValue = Number(draftMaxResultsInput)
    const nextMaxResults = Number.isFinite(parsedValue) ? Math.min(100, Math.max(1, Math.trunc(parsedValue))) : 1

    void persist(() => setMaxResults(nextMaxResults), 'Failed to save web search max results').then((result) => {
      if (result.ok) {
        setDraftMaxResultsInput(String(nextMaxResults))
        setMaxResultsBaseline(nextMaxResults)
      }
    })
  }

  const resetMaxResults = () => {
    void persist(() => setMaxResults(DEFAULT_MAX_RESULTS), 'Failed to reset web search max results').then((result) => {
      if (result.ok) {
        setDraftMaxResultsInput(String(DEFAULT_MAX_RESULTS))
        setMaxResultsBaseline(DEFAULT_MAX_RESULTS)
      }
    })
  }

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.tool.websearch.search_provider')}</SettingTitle>
        <SettingDivider />
        <SettingRow className={settingRowClassName}>
          <SettingRowTitle className={settingLabelClassName}>
            {t('settings.tool.websearch.default_provider')}
          </SettingRowTitle>
          <Select
            value={defaultProvider?.id}
            onValueChange={(providerId) =>
              updateSelectedWebSearchProvider(providerId, setDefaultSearchKeywordsProvider)
            }>
            <SelectTrigger size="sm" className={selectTriggerClassName}>
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
        <SettingRow className={settingRowClassName}>
          <SettingRowTitle className={settingLabelClassName}>
            {t('settings.tool.websearch.fetch_urls_provider')}
          </SettingRowTitle>
          <Select
            value={defaultFetchUrlsProvider?.id}
            onValueChange={(providerId) => updateSelectedWebSearchProvider(providerId, setDefaultFetchUrlsProvider)}>
            <SelectTrigger size="sm" className={selectTriggerClassName}>
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
        <SettingRow className={settingRowClassName}>
          <SettingRowTitle className={settingLabelClassName}>
            {t('settings.tool.websearch.search_max_result.label')}
            {maxResults > 20 && compressionConfig?.method === 'none' && (
              <InfoTooltip
                content={t('settings.tool.websearch.search_max_result.tooltip')}
                iconProps={{ size: 16, color: 'var(--color-icon)', className: 'ml-1 cursor-pointer' }}
              />
            )}
          </SettingRowTitle>
          <div className="flex w-56 shrink-0 items-center justify-end gap-2">
            {!isMaxResultsDefault && (
              <Tooltip content={t('common.reset')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-icon hover:text-foreground"
                  aria-label={t('common.reset')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={resetMaxResults}>
                  <ResetIcon size={14} />
                </Button>
              </Tooltip>
            )}
            <Input
              aria-label={t('settings.tool.websearch.search_max_result.label')}
              type="number"
              min={1}
              max={100}
              step={1}
              value={draftMaxResultsInput}
              className="h-8 w-20 text-center text-sm"
              onChange={(e) => setDraftMaxResultsInput(e.target.value)}
              onBlur={commitMaxResultsDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
            />
          </div>
        </SettingRow>
        <CompressionSettings />
      </SettingGroup>
    </>
  )
}

export default BasicSettings
