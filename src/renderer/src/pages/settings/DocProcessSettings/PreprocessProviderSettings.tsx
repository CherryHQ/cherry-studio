import { ExportOutlined } from '@ant-design/icons'
import { ApiKeyListPopup } from '@renderer/components/Popups/ApiKeyListPopup'
import { getPreprocessProviderLogo, PREPROCESS_PROVIDER_CONFIG } from '@renderer/config/preprocessProviders'
import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import type { PreprocessProvider } from '@renderer/types'
import { formatApiKeys, hasObjectKey } from '@renderer/utils'
import { Avatar, Button, Divider, Flex, Input, Tooltip } from 'antd'
import Link from 'antd/es/typography/Link'
import { List } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle, SettingTitle } from '..'

interface Props {
  provider: PreprocessProvider
}

const PreprocessProviderSettings: FC<Props> = ({ provider: _provider }) => {
  const { provider: preprocessProvider, updateProvider } = usePreprocessProvider(_provider.id)
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(preprocessProvider.apiKey || '')
  const [apiHost, setApiHost] = useState(preprocessProvider.apiHost || '')
  // const [options, setOptions] = useState(preprocessProvider.options || {})

  const preprocessProviderConfig = PREPROCESS_PROVIDER_CONFIG[preprocessProvider.id]
  const apiKeyWebsite = preprocessProviderConfig?.websites?.apiKey
  const officialWebsite = preprocessProviderConfig?.websites?.official

  useEffect(() => {
    setApiKey(preprocessProvider.apiKey ?? '')
    setApiHost(preprocessProvider.apiHost ?? '')
    // setOptions(preprocessProvider.options ?? {})
  }, [preprocessProvider.apiKey, preprocessProvider.apiHost, preprocessProvider.options])

  const onUpdateApiKey = () => {
    if (apiKey !== preprocessProvider.apiKey) {
      updateProvider({ apiKey, quota: undefined })
    }
  }

  const openApiKeyList = async () => {
    await ApiKeyListPopup.show({
      providerId: preprocessProvider.id,
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

  // const onUpdateOptions = (key: string, value: any) => {
  //   const newOptions = { ...options, [key]: value }
  //   setOptions(newOptions)
  //   updateProvider({ options: newOptions })
  // }

  return (
    <>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ProviderLogo shape="square" src={getPreprocessProviderLogo(preprocessProvider.id)} size={16} />
          <ProviderName> {preprocessProvider.name}</ProviderName>
          {officialWebsite && preprocessProviderConfig?.websites && (
            <Link target="_blank" href={preprocessProviderConfig.websites.official}>
              <ExportOutlined className="text-[--color-text] text-[12px]" />
            </Link>
          )}
        </Flex>
      </SettingTitle>
      <Divider className="my-[10px] w-full" />
      {hasObjectKey(preprocessProvider, 'apiKey') && (
        <>
          <SettingSubtitle className="mt-[5px] mb-[10px] flex items-center justify-between">
            {preprocessProvider.id === 'paddleocr'
              ? t('settings.tool.preprocess.paddleocr.aistudio_access_token')
              : t('settings.provider.api_key.label')}
            {preprocessProvider.id !== 'paddleocr' && (
              <Tooltip title={t('settings.provider.api.key.list.open')} mouseEnterDelay={0.5}>
                <Button type="text" size="small" onClick={openApiKeyList} icon={<List size={14} />} />
              </Tooltip>
            )}
          </SettingSubtitle>
          <Flex gap={8}>
            <Input.Password
              value={apiKey}
              placeholder={
                preprocessProvider.id === 'mineru'
                  ? t('settings.mineru.api_key')
                  : preprocessProvider.id === 'paddleocr'
                    ? t('settings.tool.preprocess.paddleocr.aistudio_access_token')
                    : t('settings.provider.api_key.label')
              }
              onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
              onBlur={onUpdateApiKey}
              spellCheck={false}
              type="password"
              autoFocus={apiKey === ''}
            />
          </Flex>
          {preprocessProvider.id !== 'paddleocr' && (
            <SettingHelpTextRow className="mt-[5px] justify-between">
              <SettingHelpLink target="_blank" href={apiKeyWebsite}>
                {t('settings.provider.get_api_key')}
              </SettingHelpLink>
              <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
            </SettingHelpTextRow>
          )}
        </>
      )}

      {hasObjectKey(preprocessProvider, 'apiHost') && (
        <>
          <SettingSubtitle className="mt-[5px] mb-[10px]">
            {preprocessProvider.id === 'paddleocr'
              ? t('settings.tool.preprocess.paddleocr.api_url')
              : t('settings.provider.api_host')}
          </SettingSubtitle>
          <Flex>
            <Input
              value={apiHost}
              placeholder={
                preprocessProvider.id === 'paddleocr'
                  ? t('settings.tool.preprocess.paddleocr.api_url')
                  : t('settings.provider.api_host')
              }
              onChange={(e) => setApiHost(e.target.value)}
              onBlur={onUpdateApiHost}
            />
          </Flex>
          {preprocessProvider.id === 'paddleocr' && (
            <SettingHelpTextRow className="!flex-col">
              <div className="!flex !gap-3">
                <SettingHelpLink
                  className="!inline-block"
                  target="_blank"
                  href="https://aistudio.baidu.com/paddleocr/task">
                  {t('settings.tool.preprocess.paddleocr.api_url_label')}
                </SettingHelpLink>
                <SettingHelpLink className="!inline-block" target="_blank" href="https://aistudio.baidu.com/paddleocr">
                  {t('settings.tool.preprocess.paddleocr.paddleocr_url_label')}
                </SettingHelpLink>
              </div>
            </SettingHelpTextRow>
          )}
        </>
      )}

      {/* 这部分看起来暂时用不上了 */}
      {/* {hasObjectKey(preprocessProvider, 'options') && preprocessProvider.id === 'system' && (
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
      )} */}
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
