import { ExportOutlined } from '@ant-design/icons'
import { getTraceProviderLogo, TRACE_PROVIDER_CONFIG } from '@renderer/config/traceProviders'
import { useTrace } from '@renderer/hooks/useTrace'
import { Divider, Flex, Input } from 'antd'
import Link from 'antd/es/typography/Link'
import { FC, useDeferredValue } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingSubtitle, SettingTitle } from '..'

const LangfuseSettings: FC = () => {
  const { t } = useTranslation()
  const { langfuse, updateLangfuse } = useTrace()
  const baseUrl = useDeferredValue(langfuse.baseUrl)
  const publicKey = useDeferredValue(langfuse.publicKey)
  const secretKey = useDeferredValue(langfuse.secretKey)

  const providerConfig = TRACE_PROVIDER_CONFIG.langfuse
  const officialWebsite = providerConfig?.websites?.official

  const updateBaseUrl = (value: string) => {
    if (value !== langfuse.baseUrl) {
      updateLangfuse({ baseUrl: value })
    }
  }

  const updatePublicKey = (value: string) => {
    if (value !== langfuse.publicKey) {
      updateLangfuse({ publicKey: value })
    }
  }

  const updateSecretKey = (value: string) => {
    if (value !== langfuse.secretKey) {
      updateLangfuse({ secretKey: value })
    }
  }

  return (
    <>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ProviderLogo src={getTraceProviderLogo(providerConfig.name)} />
          <ProviderName>{providerConfig.name}</ProviderName>
          {officialWebsite && (
            <Link target="_blank" href={officialWebsite}>
              <ExportOutlined style={{ color: 'var(--color-text)', fontSize: '12px' }} />
            </Link>
          )}
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <>
        <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
          {t('settings.trace.langfuse.secret_key')}
        </SettingSubtitle>
        <Input.Password
          value={secretKey}
          placeholder={t('settings.trace.langfuse.secret_key')}
          onChange={(e) => updateSecretKey(e.target.value)}
          spellCheck={false}
          type="password"
        />
      </>
      <>
        <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
          {t('settings.trace.langfuse.public_key')}
        </SettingSubtitle>
        <Input.Password
          value={publicKey}
          placeholder={t('settings.trace.langfuse.public_key')}
          onChange={(e) => updatePublicKey(e.target.value)}
          spellCheck={false}
          type="password"
        />
      </>
      <>
        <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
          {t('settings.trace.langfuse.base_url')}
        </SettingSubtitle>
        <Input
          value={baseUrl}
          placeholder={t('settings.trace.langfuse.base_url')}
          onChange={(e) => updateBaseUrl(e.target.value)}
          onBlur={() => updateBaseUrl(baseUrl)}
        />
      </>
    </>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
`
const ProviderLogo = styled.img`
  width: 20px;
  height: 20px;
  object-fit: contain;
`

export default LangfuseSettings
