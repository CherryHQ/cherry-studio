import { InfoTooltip } from '@cherrystudio/ui'
import Selector from '@renderer/components/Selector'
import { getWebSearchProviderLogo, webSearchProviderRequiresApiKey } from '@renderer/config/webSearchProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import {
  useDefaultWebSearchProvider,
  useWebSearchProviders,
  useWebSearchSettings
} from '@renderer/hooks/useWebSearchProviders'
import type { WebSearchProvider } from '@renderer/types'
import { useNavigate } from '@tanstack/react-router'
import { Slider } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const { maxResults, compressionConfig, setMaxResults } = useWebSearchSettings()
  const navigate = useNavigate()
  const [draftMaxResults, setDraftMaxResults] = useState(maxResults)

  useEffect(() => {
    setDraftMaxResults(maxResults)
  }, [maxResults])

  const updateSelectedWebSearchProvider = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId)
    if (provider) {
      const needsApiKey = webSearchProviderRequiresApiKey(provider.id)
      const hasApiKey = provider.apiKey?.trim() !== ''
      const isAvailable = webSearchService.isWebSearchEnabled(provider.id)

      if (!isAvailable) {
        window.modal.confirm({
          title:
            needsApiKey && !hasApiKey
              ? t('settings.tool.websearch.api_key_required.title')
              : t('settings.provider.api_host'),
          content:
            needsApiKey && !hasApiKey
              ? t('settings.tool.websearch.api_key_required.content', { provider: provider.name })
              : `${provider.name} ${t('settings.provider.api_host')}`,
          okText: needsApiKey && !hasApiKey ? t('settings.tool.websearch.api_key_required.ok') : t('go_to_settings'),
          cancelText: t('common.cancel'),
          centered: true,
          onOk: () => {
            void navigate({ to: '/settings/websearch/provider/$providerId', params: { providerId: provider.id } })
          }
        })
        return
      }

      setDefaultProvider(provider)
    }
  }

  const renderProviderLabel = (provider: WebSearchProvider) => {
    const logo = getWebSearchProviderLogo(provider.id)
    const needsApiKey = webSearchProviderRequiresApiKey(provider.id)

    return (
      <div className="flex items-center gap-2">
        {logo ? (
          <logo.Avatar size={16} shape="rounded" />
        ) : (
          <div className="h-4 w-4 rounded-sm bg-[var(--color-background-soft)]" />
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
        <SettingRow>
          <SettingRowTitle>{t('settings.tool.websearch.default_provider')}</SettingRowTitle>
          <Selector
            size={14}
            value={defaultProvider?.id}
            onChange={(value: string) => updateSelectedWebSearchProvider(value)}
            placeholder={t('settings.tool.websearch.search_provider_placeholder')}
            options={providers.map((p) => ({
              value: p.id,
              label: renderProviderLabel(p)
            }))}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme} style={{ paddingBottom: 8 }}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow style={{ height: 40 }}>
          <SettingRowTitle style={{ minWidth: 120 }}>
            {t('settings.tool.websearch.search_max_result.label')}
            {maxResults > 20 && compressionConfig?.method === 'none' && (
              <InfoTooltip
                content={t('settings.tool.websearch.search_max_result.tooltip')}
                iconProps={{ size: 16, color: 'var(--color-icon)', className: 'ml-1 cursor-pointer' }}
              />
            )}
          </SettingRowTitle>
          <Slider
            value={draftMaxResults}
            style={{ width: '100%' }}
            min={1}
            max={100}
            step={1}
            marks={{ 1: '1', 5: '5', 20: '20', 50: '50', 100: '100' }}
            onChange={(value) => setDraftMaxResults(value)}
            onChangeComplete={(value) => void setMaxResults(value)}
          />
        </SettingRow>
      </SettingGroup>
    </>
  )
}

export default BasicSettings
