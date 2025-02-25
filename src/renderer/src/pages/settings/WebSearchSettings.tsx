import tavilyLogo from '@renderer/assets/images/search/tavily.svg'
import tavilyLogoDark from '@renderer/assets/images/search/tavily-dark.svg'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setSearchWithTime } from '@renderer/store/websearch'
import { Input, Switch, InputNumber, Typography } from 'antd'
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
  const [maxResults, setMaxResults] = useState(provider.maxResults || 5)
  const [excludedDomainsInput, setExcludedDomainsInput] = useState(
    provider.excludedDomains ? provider.excludedDomains.join(', ') : ''
  )
  const logo = theme === 'dark' ? tavilyLogoDark : tavilyLogo
  const searchWithTime = useAppSelector((state) => state.websearch.searchWithTime)
  const dispatch = useAppDispatch()

  useEffect(() => {
    return () => {
      if (apiKey && apiKey !== provider.apiKey) {
        updateProvider({
          ...provider,
          apiKey,
          maxResults,
          excludedDomains: parseExcludedDomains(excludedDomainsInput)
        })
      }
    }
  }, [apiKey, provider, updateProvider, maxResults, excludedDomainsInput])

  // 解析逗号分隔的域名字符串为数组
  const parseExcludedDomains = (input: string): string[] => {
    if (!input) return []
    return input
      .split(',')
      .map((domain) => domain.trim())
      .filter((domain) => domain)
  }

  const handleMaxResultsChange = (value) => {
    setMaxResults(value)
    updateProvider({
      ...provider,
      maxResults: value
    })
  }

  const handleExcludedDomainsChange = (e) => {
    const value = e.target.value
    setExcludedDomainsInput(value)
  }

  const handleExcludedDomainsBlur = () => {
    const domains = parseExcludedDomains(excludedDomainsInput)
    updateProvider({
      ...provider,
      excludedDomains: domains
    })
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
        <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
          <SettingHelpLink target="_blank" href="https://app.tavily.com/home">
            {t('settings.websearch.get_api_key')}
          </SettingHelpLink>
        </SettingHelpTextRow>

        <div className="setting-item" style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>{t('settings.websearch.max_results.label')}:</label>
          <InputNumber min={1} value={maxResults} onChange={handleMaxResultsChange} style={{ width: '100%' }} />
        </div>

        <div className="setting-item">
          <label style={{ display: 'block', marginBottom: '5px' }}>
            {t('settings.websearch.excluded_domains.label')}:
          </label>
          <Input
            value={excludedDomainsInput}
            onChange={handleExcludedDomainsChange}
            onBlur={handleExcludedDomainsBlur}
            onPressEnter={handleExcludedDomainsBlur}
            placeholder={t('settings.websearch.excluded_domains.placeholder')}
            style={{ width: '100%' }}
          />
          <div style={{ fontSize: '12px', color: 'var(--color-text-3)', marginTop: '5px' }}>
            {t('settings.websearch.excluded_domains.help')}
          </div>
        </div>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />

        <SettingRow>
          <SettingRowTitle>{t('settings.websearch.search_with_time')}</SettingRowTitle>
          <Switch checked={searchWithTime} onChange={(checked) => dispatch(setSearchWithTime(checked))} />
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

const TavilyLogo = styled.img`
  width: 80px;
`

export default WebSearchSettings
