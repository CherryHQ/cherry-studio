import { ExportOutlined } from '@ant-design/icons'
import { getOcrProviderLogo, OCR_PROVIDER_CONFIG } from '@renderer/config/ocrProviders'
import { useOcrProvider } from '@renderer/hooks/useOcr'
import { OcrProvider } from '@renderer/types'
import { formatApiKeys, hasObjectKey } from '@renderer/utils'
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
  provider: OcrProvider
}

const OcrProviderSettings: FC<Props> = ({ provider: _provider }) => {
  const { provider: ocrProvider, updateOcrProvider } = useOcrProvider(_provider.id)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(ocrProvider.apiKey || '')
  const [apiHost, setApiHost] = useState(ocrProvider.apiHost || '')
  const [options, setOptions] = useState(ocrProvider.options || {})

  const ocrProviderConfig = OCR_PROVIDER_CONFIG[ocrProvider.id]
  const apiKeyWebsite = ocrProviderConfig?.websites?.apiKey
  const officialWebsite = ocrProviderConfig?.websites?.official

  useEffect(() => {
    setApiKey(ocrProvider.apiKey ?? '')
    setApiHost(ocrProvider.apiHost ?? '')
    setOptions(ocrProvider.options ?? {})
  }, [ocrProvider.apiKey, ocrProvider.apiHost, ocrProvider.options])

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

  const onUpdateOptions = (key: string, value: any) => {
    const newOptions = { ...options, [key]: value }
    setOptions(newOptions)
    updateOcrProvider({ ...ocrProvider, options: newOptions })
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
              {t('settings.provider.get_api_key')}
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

      {hasObjectKey(ocrProvider, 'options') && ocrProvider.id === 'system' && (
        <>
          <SettingRow>
            <SettingRowTitle>{t('settings.tool.ocr.mac_system_ocr_options.mode.title')}</SettingRowTitle>
            <Segmented
              options={[
                {
                  label: t('settings.tool.ocr.mac_system_ocr_options.mode.accurate'),
                  value: 1
                },
                {
                  label: t('settings.tool.ocr.mac_system_ocr_options.mode.fast'),
                  value: 0
                }
              ]}
              value={options.recognitionLevel}
              onChange={(value) => onUpdateOptions('recognitionLevel', value)}
            />
          </SettingRow>
          <SettingDivider style={{ marginTop: 15, marginBottom: 12 }} />
          <SettingRow>
            <SettingRowTitle>{t('settings.tool.ocr.mac_system_ocr_options.min_confidence')}</SettingRowTitle>
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

export default OcrProviderSettings
