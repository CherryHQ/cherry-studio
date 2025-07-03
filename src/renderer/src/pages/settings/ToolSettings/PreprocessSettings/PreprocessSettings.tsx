import { ExportOutlined } from '@ant-design/icons'
import { getPreprocessProviderLogo, PREPROCESS_PROVIDER_CONFIG } from '@renderer/config/preprocessProviders'
import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import { formatApiKeys } from '@renderer/services/ApiService'
import { PreprocessProvider } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import { Avatar, Divider, Flex, Input, InputNumber, Segmented } from 'antd'
import Link from 'antd/es/typography/Link'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  SettingDivider,
  SettingHelpLink,
  SettingHelpText,
  SettingHelpTextRow,
  SettingRow,
  SettingRowTitle,
  SettingSubtitle,
  SettingTitle
} from '../..'

interface Props {
  provider: PreprocessProvider
}

const PreprocessProviderSettings: FC<Props> = ({ provider: _provider }) => {
  const { provider: preprocessProvider, updatePreprocessProvider } = usePreprocessProvider(_provider.id)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(preprocessProvider.apiKey || '')
  const [apiHost, setApiHost] = useState(preprocessProvider.apiHost || '')
  const [options, setOptions] = useState(preprocessProvider.options || {})

  const preprocessProviderConfig = PREPROCESS_PROVIDER_CONFIG[preprocessProvider.id]
  const apiKeyWebsite = preprocessProviderConfig?.websites?.apiKey
  const officialWebsite = preprocessProviderConfig?.websites?.official

  useEffect(() => {
    setApiKey(preprocessProvider.apiKey ?? '')
    setApiHost(preprocessProvider.apiHost ?? '')
    setOptions(preprocessProvider.options ?? {})
  }, [preprocessProvider.apiKey, preprocessProvider.apiHost, preprocessProvider.options])

  const onUpdateApiKey = () => {
    if (apiKey !== preprocessProvider.apiKey) {
      updatePreprocessProvider({ ...preprocessProvider, apiKey, quota: undefined })
    }
  }

  const onUpdateApiHost = () => {
    let trimmedHost = apiHost?.trim() || ''
    if (trimmedHost.endsWith('/')) {
      trimmedHost = trimmedHost.slice(0, -1)
    }
    if (trimmedHost !== preprocessProvider.apiHost) {
      updatePreprocessProvider({ ...preprocessProvider, apiHost: trimmedHost })
    } else {
      setApiHost(preprocessProvider.apiHost || '')
    }
  }

  const onUpdateOptions = (key: string, value: any) => {
    const newOptions = { ...options, [key]: value }
    setOptions(newOptions)
    updatePreprocessProvider({ ...preprocessProvider, options: newOptions })
  }

  return (
    <>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ProviderLogo shape="square" src={getPreprocessProviderLogo(preprocessProvider.id)} size={16} />

          <ProviderName> {preprocessProvider.name}</ProviderName>
          {officialWebsite && preprocessProviderConfig?.websites && (
            <Link target="_blank" href={preprocessProviderConfig.websites.official}>
              <ExportOutlined style={{ color: 'var(--color-text)', fontSize: '12px' }} />
            </Link>
          )}
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      {hasObjectKey(preprocessProvider, 'apiKey') && (
        <>
          <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>{t('settings.provider.api_key')}</SettingSubtitle>
          <Flex gap={8}>
            <Input.Password
              value={apiKey}
              placeholder={
                preprocessProvider.id === 'mineru' ? t('settings.mineru.api_key') : t('settings.provider.api_key')
              }
              onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
              onBlur={onUpdateApiKey}
              spellCheck={false}
              type="password"
              autoFocus={apiKey === ''}
            />
          </Flex>
          <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.provider.get_api_key')}
            </SettingHelpLink>
            <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
          </SettingHelpTextRow>
        </>
      )}

      {hasObjectKey(preprocessProvider, 'apiHost') && (
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

      {hasObjectKey(preprocessProvider, 'options') && preprocessProvider.id === 'system' && (
        <>
          <SettingDivider style={{ marginTop: 15, marginBottom: 12 }} />
          <SettingRow>
            <SettingRowTitle>{t('settings.tool.preprocess.mac_system_ocr_options.mode.title')}</SettingRowTitle>
            <Segmented
              options={[
                {
                  label: t('settings.tool.preprocess.mac_system_ocr_options.mode.accurate'),
                  value: 1
                },
                {
                  label: t('settings.tool.preprocess.mac_system_ocr_options.mode.fast'),
                  value: 0
                }
              ]}
              value={options.recognitionLevel}
              onChange={(value) => onUpdateOptions('recognitionLevel', value)}
            />
          </SettingRow>
          <SettingDivider style={{ marginTop: 15, marginBottom: 12 }} />
          <SettingRow>
            <SettingRowTitle>{t('settings.tool.preprocess.mac_system_ocr_options.min_confidence')}</SettingRowTitle>
            <InputNumber
              value={options.minConfidence}
              onChange={(value) => onUpdateOptions('minConfidence', value)}
              min={0}
              max={1}
              step={0.1}
            />
          </SettingRow>
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

export default PreprocessProviderSettings
