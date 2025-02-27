import tavilyLogo from '@renderer/assets/images/search/tavily.svg'
import tavilyLogoDark from '@renderer/assets/images/search/tavily-dark.svg'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setExcludeDomains, setMaxResult, setSearchWithTime } from '@renderer/store/websearch'
import { formatDomains } from '@renderer/utils/blacklist'
import { Alert, Button, Input, Slider, Switch, Typography } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingHelpLink,
  SettingHelpTextRow,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '.'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { Paragraph } = Typography
  const { theme } = useTheme()
  const { provider, updateProvider } = useWebSearchProvider('tavily')
  const [apiKey, setApiKey] = useState(provider.apiKey)
  const logo = theme === 'dark' ? tavilyLogoDark : tavilyLogo
  const searchWithTime = useAppSelector((state) => state.websearch.searchWithTime)
  const maxResults = useAppSelector((state) => state.websearch.maxResults)
  const excludeDomains = useAppSelector((state) => state.websearch.excludeDomains)
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const { provider: searxngProvider } = useWebSearchProvider('searxng')

  const dispatch = useAppDispatch()

  useEffect(() => {
    return () => {
      if (apiKey && apiKey !== provider.apiKey) {
        updateProvider({ ...provider, apiKey })
      }
    }
  }, [apiKey, provider, updateProvider])

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

  async function search() {
    await WebSearchService.search(provider, 'Cherry Studio')
    await WebSearchService.search(searxngProvider, 'Cherry Studio')

    // await SearxngProvider.search('Cherry Studio')
  }
  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <HStack alignItems="center" gap={10}>
          <TavilyLogo src={logo} alt="web-search" style={{ width: '60px' }} />
        </HStack>
        <SettingDivider />
        <Paragraph type="secondary" style={{ margin: '10px 0' }}>
          {t('settings.websearch.tavily.description')}
        </Paragraph>
        <Input.Password
          style={{ width: '100%' }}
          placeholder={t('settings.websearch.tavily.api_key.placeholder')}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onBlur={() => updateProvider({ ...provider, apiKey })}
        />
        <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
          <SettingHelpLink target="_blank" href="https://app.tavily.com/home">
            {t('settings.websearch.get_api_key')}
          </SettingHelpLink>
        </SettingHelpTextRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
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
        <Button onClick={async () => await search()}>test</Button>
      </SettingGroup>
    </SettingContainer>
  )
}

const TavilyLogo = styled.img`
  width: 80px;
`

export default WebSearchSettings
