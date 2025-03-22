import { ExportOutlined } from '@ant-design/icons'
import { getOcrProviderLogo, OCR_PROVIDER_CONFIG } from '@renderer/config/ocrProviders'
import { useOcrProvider } from '@renderer/hooks/useKnowledge'
import { formatApiKeys } from '@renderer/services/ApiService'
import { OcrProvider } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { Avatar, Divider, Flex, Input } from 'antd'
import Link from 'antd/es/typography/Link'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle, SettingTitle } from '..'

interface Props {
  provider: OcrProvider
}

const OcrProviderSetting: FC<Props> = ({ provider: _provider }) => {
  const { ocrProvider, updateOcrProvider } = useOcrProvider(_provider.id)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(ocrProvider.apiKey || '')
  const [apiHost, setApiHost] = useState(ocrProvider.apiHost || '')

  const ocrProviderConfig = OCR_PROVIDER_CONFIG[ocrProvider.id]
  const apiKeyWebsite = ocrProviderConfig?.websites?.apiKey
  const officialWebsite = ocrProviderConfig?.websites?.official

  useEffect(() => {
    setApiKey(ocrProvider.apiKey ?? '')
    setApiHost(ocrProvider.apiHost ?? '')
  }, [ocrProvider.apiKey, ocrProvider.apiHost])

  const onUpdateApiKey = () => {
    if (apiKey !== ocrProvider.apiKey) {
      updateOcrProvider({ ...ocrProvider, apiKey })
    }
  }

  const onUpdateApiHost = () => {
    let trimmedHost = apiHost?.trim() || ''
    if (trimmedHost.endsWith('/')) {
      trimmedHost = trimmedHost.slice(0, -1)
    }
    if (trimmedHost !== ocrProvider.apiHost) {
      updateOcrProvider({ ...ocrProvider, apiHost: trimmedHost })
    } else {
      setApiHost(ocrProvider.apiHost || '')
    }
  }

  return (
    <>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ProviderLogo shape="square" src={getOcrProviderLogo(ocrProvider.id)} size={16} />

          <ProviderName> {ocrProvider.name}</ProviderName>
          {officialWebsite && ocrProviderConfig?.websites && (
            <Link target="_blank" href={ocrProviderConfig.websites.official}>
              <ExportOutlined style={{ color: 'var(--color-text)', fontSize: '12px' }} />
            </Link>
          )}
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      {hasObjectKey(ocrProvider, 'apiKey') && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>{t('settings.provider.api_key')}</SettingSubtitle>
          <Flex gap={8}>
            <Input.Password
              value={apiKey}
              placeholder={t('settings.provider.api_key')}
              onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
              onBlur={onUpdateApiKey}
              spellCheck={false}
              type="password"
              autoFocus={apiKey === ''}
            />
          </Flex>
          <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.websearch.get_api_key')}
            </SettingHelpLink>
            <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
          </SettingHelpTextRow>
        </>
      )}

      {hasObjectKey(ocrProvider, 'apiHost') && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
            {t('settings.provider.api_host')}
          </SettingSubtitle>
          <Flex>
            <Input
              value={apiHost}
              placeholder={t('settings.provider.api_host')}
              onChange={(e) => setApiHost(e.target.value)}
              onBlur={onUpdateApiHost}
            />
          </Flex>
        </>
      )}
    </>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
`
const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`

export default OcrProviderSetting
