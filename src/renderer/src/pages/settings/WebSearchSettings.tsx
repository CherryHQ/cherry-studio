import tavilyLogo from '@renderer/assets/images/search/tavily.svg'
import tavilyLogoDark from '@renderer/assets/images/search/tavily-dark.svg'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import { Input, Typography } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingHelpLink, SettingHelpTextRow } from '.'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { Paragraph } = Typography
  const { theme } = useTheme()
  const { provider, updateProvider } = useWebSearchProvider('tavily')
  const [apiKey, setApiKey] = useState(provider.apiKey)

  const logo = theme === 'dark' ? tavilyLogoDark : tavilyLogo

  useEffect(() => {
    return () => {
      console.log('apiKey', apiKey, provider.apiKey)
      if (apiKey && apiKey !== provider.apiKey) {
        updateProvider({ ...provider, apiKey })
      }
    }
  }, [apiKey, provider, updateProvider])

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
    </SettingContainer>
  )
}

const TavilyLogo = styled.img`
  width: 80px;
`

export default WebSearchSettings
