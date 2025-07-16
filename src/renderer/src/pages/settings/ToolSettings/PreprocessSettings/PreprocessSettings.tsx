import { ExportOutlined } from '@ant-design/icons'
import { ApiKeyListPopup } from '@renderer/components/Popups/ApiKeyListPopup'
import { getPreprocessProviderLogo, PREPROCESS_PROVIDER_CONFIG } from '@renderer/config/preprocessProviders'
import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import { PreprocessProvider } from '@renderer/types'
import { formatApiKeys, hasObjectKey } from '@renderer/utils'
import { Avatar, Button, Divider, Flex, Input, InputNumber, Segmented, Tooltip } from 'antd'
import Link from 'antd/es/typography/Link'
import { List } from 'lucide-react'
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
  const { provider: preprocessProvider, updateProvider } = usePreprocessProvider(_provider.id)
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
      updateProvider({ apiKey, quota: undefined })
    }
  }

  const openApiKeyList = async () => {
    await ApiKeyListPopup.show({
      providerId: preprocessProvider.id,
      providerKind: 'doc-preprocess',
      title: `${preprocessProvider.name} ${t('settings.provider.api.key.list.title')}`,
      showHealthCheck: false // FIXME: 目前还没有检查功能
    })
  }

  const onUpdateApiHost = () => {
    let trimmedHost = apiHost?.trim() || ''
    if (trimmedHost.endsWith('/')) {
      trimmedHost = trimmedHost.slice(0, -1)
    }
    if (trimmedHost !== preprocessProvider.apiHost) {
      updateProvider({ apiHost: trimmedHost })
    } else {
      setApiHost(preprocessProvider.apiHost || '')
    }
  }

  const onUpdateOptions = (key: string, value: any) => {
    const newOptions = { ...options, [key]: value }
    setOptions(newOptions)
    updateProvider({ options: newOptions })
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
          <SettingSubtitle
            style={{
              marginTop: 5,
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
            {t('settings.provider.api_key')}
            <Tooltip title={t('settings.provider.api.key.list.open')} mouseEnterDelay={0.5}>
              <Button type="text" size="small" onClick={openApiKeyList} icon={<List size={14} />} />
            </Tooltip>
          </SettingSubtitle>
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
