import BaiduLogo from '@renderer/assets/images/search/baidu.svg'
import BingLogo from '@renderer/assets/images/search/bing.svg'
import BochaLogo from '@renderer/assets/images/search/bocha.webp'
import ExaLogo from '@renderer/assets/images/search/exa.png'
import GoogleLogo from '@renderer/assets/images/search/google.svg'
import SearxngLogo from '@renderer/assets/images/search/searxng.svg'
import TavilyLogo from '@renderer/assets/images/search/tavily.png'
import ZhipuLogo from '@renderer/assets/images/search/zhipu.png'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import {
  useDefaultWebSearchProvider,
  useWebSearchProviders,
  useWebSearchSettings
} from '@renderer/hooks/useWebSearchProviders'
import { useAppDispatch } from '@renderer/store'
import { setMaxResult, setSearchWithTime } from '@renderer/store/websearch'
import type { WebSearchProvider, WebSearchProviderId } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { Slider, Switch, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

// Provider logos map
const getProviderLogo = (providerId: WebSearchProviderId): string | undefined => {
  switch (providerId) {
    case 'zhipu':
      return ZhipuLogo
    case 'tavily':
      return TavilyLogo
    case 'searxng':
      return SearxngLogo
    case 'exa':
    case 'exa-mcp':
      return ExaLogo
    case 'bocha':
      return BochaLogo
    case 'local-google':
      return GoogleLogo
    case 'local-bing':
      return BingLogo
    case 'local-baidu':
      return BaiduLogo
    default:
      return undefined
  }
}

const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const { searchWithTime, maxResults, compressionConfig } = useWebSearchSettings()
  const navigate = useNavigate()

  const dispatch = useAppDispatch()

  const updateSelectedWebSearchProvider = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId)
    if (provider) {
      // Check if provider needs API key but doesn't have one
      const needsApiKey = hasObjectKey(provider, 'apiKey')
      const hasApiKey = provider.apiKey && provider.apiKey.trim() !== ''

      if (needsApiKey && !hasApiKey) {
        // Don't allow selection, show modal to configure
        window.modal.confirm({
          title: t('settings.tool.websearch.api_key_required.title'),
          content: t('settings.tool.websearch.api_key_required.content', { provider: provider.name }),
          okText: t('settings.tool.websearch.api_key_required.ok'),
          cancelText: t('common.cancel'),
          centered: true,
          onOk: () => {
            navigate(`/settings/websearch/provider/${provider.id}`)
          }
        })
        return
      }

      setDefaultProvider(provider as WebSearchProvider)
    }
  }

  // Sort providers: API providers first, then local providers
  const sortedProviders = [...providers].sort((a, b) => {
    const aIsLocal = a.id.startsWith('local')
    const bIsLocal = b.id.startsWith('local')
    if (aIsLocal && !bIsLocal) return 1
    if (!aIsLocal && bIsLocal) return -1
    return 0
  })

  const renderProviderLabel = (provider: WebSearchProvider) => {
    const logo = getProviderLogo(provider.id)
    const needsApiKey = hasObjectKey(provider, 'apiKey')

    return (
      <div className="flex items-center gap-2">
        {logo ? (
          <img src={logo} alt={provider.name} className="h-4 w-4 rounded-sm object-contain" />
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
            options={sortedProviders.map((p) => ({
              value: p.id,
              label: renderProviderLabel(p)
            }))}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme} style={{ paddingBottom: 8 }}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.tool.websearch.search_with_time')}</SettingRowTitle>
          <Switch checked={searchWithTime} onChange={(checked) => dispatch(setSearchWithTime(checked))} />
        </SettingRow>
        <SettingDivider style={{ marginTop: 15, marginBottom: 10 }} />
        <SettingRow style={{ height: 40 }}>
          <SettingRowTitle style={{ minWidth: 120 }}>
            {t('settings.tool.websearch.search_max_result.label')}
            {maxResults > 20 && compressionConfig?.method === 'none' && (
              <Tooltip title={t('settings.tool.websearch.search_max_result.tooltip')} placement="top">
                <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
              </Tooltip>
            )}
          </SettingRowTitle>
          <Slider
            defaultValue={maxResults}
            style={{ width: '100%' }}
            min={1}
            max={100}
            step={1}
            marks={{ 1: '1', 5: '5', 20: '20', 50: '50', 100: '100' }}
            onChangeComplete={(value) => dispatch(setMaxResult(value))}
          />
        </SettingRow>
      </SettingGroup>
    </>
  )
}

export default BasicSettings
