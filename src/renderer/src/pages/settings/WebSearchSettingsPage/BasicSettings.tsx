import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultWebSearchProvider, useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setExcludeDomains, setMaxResult, setSearchWithTime } from '@renderer/store/websearch'
import { formatDomains } from '@renderer/utils/blacklist'
import { Alert, Button, Select, Slider, Switch } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { t } from 'i18next'
import { FC, useEffect, useState } from 'react'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const searchWithTime = useAppSelector((state) => state.websearch.searchWithTime)
  const maxResults = useAppSelector((state) => state.websearch.maxResults)
  const excludeDomains = useAppSelector((state) => state.websearch.excludeDomains)
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])
  function updateManualBlacklist(blacklist: string) {
    const blacklistDomains = blacklist.split('\n').filter((url) => url.trim() !== '')
    const { formattedDomains, hasError } = formatDomains(blacklistDomains)
    setErrFormat(hasError)
    if (hasError) return
    dispatch(setExcludeDomains(formattedDomains))
  }
  function updateSelectedWebSearchProvider(providerId: string) {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      throw new Error(`Web search provider with id ${providerId} not found`)
    }
    setDefaultProvider(provider)
  }
  async function searchTest() {
    await WebSearchService.search(defaultProvider, 'Cherry Studio')
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.websearch.search_provider')}</SettingRowTitle>
          <Select
            value={defaultProvider.id}
            style={{ width: '200px' }}
            onChange={(value) => updateSelectedWebSearchProvider(value)}
            placeholder={t('settings.websearch.search_provider_placeholder')}
            options={providers.filter((p) => p.enabled === true).map((p) => ({ value: p.id, label: p.name }))}
          />
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.websearch.search_with_time')}</SettingRowTitle>
          <Switch checked={searchWithTime} onChange={(checked) => dispatch(setSearchWithTime(checked))} />
        </SettingRow>
        <SettingDivider style={{ marginTop: 15, marginBottom: 5 }} />
        <SettingRow style={{ marginBottom: -10 }}>
          <SettingRowTitle>{t('settings.websearch.search_max_result')}</SettingRowTitle>
          <Slider
            defaultValue={maxResults}
            style={{ width: '200px' }}
            min={1}
            max={20}
            step={1}
            marks={{ 1: '1', 5: t('settings.websearch.search_result_default'), 20: '20' }}
            onChangeComplete={(value) => dispatch(setMaxResult(value))}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.websearch.blacklist')}</SettingTitle>
        <SettingDivider />
        <SettingRow style={{ marginBottom: 10 }}>
          <SettingRowTitle>{t('settings.websearch.blacklist_description')}</SettingRowTitle>
        </SettingRow>
        <TextArea
          value={blacklistInput}
          onChange={(e) => setBlacklistInput(e.target.value)}
          onBlur={() => updateManualBlacklist(blacklistInput)}
          placeholder={t('settings.websearch.blacklist_tooltip')}
          autoSize={{ minRows: 2, maxRows: 6 }}
          rows={4}
        />
        {errFormat && <Alert message={t('settings.websearch.blacklist_tooltip')} type="error" />}
      </SettingGroup>
      <SettingGroup theme={theme}>
        <Button onClick={async () => await searchTest()}>test</Button>
      </SettingGroup>
    </SettingContainer>
  )
}
export default BasicSettings
