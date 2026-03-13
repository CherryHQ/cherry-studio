import { CheckOutlined, ExportOutlined, LoadingOutlined } from '@ant-design/icons'
import { Button, Flex, InfoTooltip, RowFlex, Tooltip } from '@cherrystudio/ui'
import {
  SettingDivider,
  SettingHelpLink,
  SettingHelpText,
  SettingHelpTextRow,
  SettingSubtitle,
  SettingTitle
} from '@renderer/pages/settings'
import { formatApiKeys } from '@renderer/utils'
import { Divider, Form, Input } from 'antd'
import Link from 'antd/es/typography/Link'
import { List } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface HeaderProps {
  logo?: string
  name: string
  officialWebsite?: string
}

export const WebSearchProviderHeader: FC<HeaderProps> = ({ logo, name, officialWebsite }) => {
  return (
    <>
      <SettingTitle>
        <Flex className="items-center gap-2" style={{ width: '100%' }}>
          {logo ? (
            <img src={logo} alt={name} className="h-5 w-5 object-contain" />
          ) : (
            <div className="h-5 w-5 rounded bg-[var(--color-background-soft)]" />
          )}
          <ProviderName>{name}</ProviderName>
          {officialWebsite && (
            <Link target="_blank" href={officialWebsite}>
              <ExportOutlined style={{ color: 'var(--color-text)', fontSize: '12px' }} />
            </Link>
          )}
        </Flex>
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
    </>
  )
}

interface LocalSectionProps {
  onOpenSettings: () => Promise<void>
  providerName: string
}

export const WebSearchLocalProviderSection: FC<LocalSectionProps> = ({ onOpenSettings, providerName }) => {
  const { t } = useTranslation()

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>
        {t('settings.tool.websearch.local_provider.settings')}
      </SettingSubtitle>
      <Button variant="default" onClick={onOpenSettings}>
        <ExportOutlined />
        {t('settings.tool.websearch.local_provider.open_settings', { provider: providerName })}
      </Button>
      <SettingHelpTextRow style={{ marginTop: 10 }}>
        <SettingHelpText>{t('settings.tool.websearch.local_provider.hint')}</SettingHelpText>
      </SettingHelpTextRow>
    </>
  )
}

interface ApiKeySectionProps {
  apiChecking: boolean
  apiKey: string
  apiKeyWebsite?: string
  apiValid: boolean
  onCheck: () => Promise<void>
  onOpenApiKeyList: () => Promise<void>
  onUpdateApiKey: () => void
  setApiKey: (value: string) => void
}

export const WebSearchProviderApiKeySection: FC<ApiKeySectionProps> = ({
  apiChecking,
  apiKey,
  apiKeyWebsite,
  apiValid,
  onCheck,
  onOpenApiKeyList,
  onUpdateApiKey,
  setApiKey
}) => {
  const { t } = useTranslation()

  return (
    <>
      <SettingSubtitle
        style={{
          marginTop: 5,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
        {t('settings.provider.api_key.label')}
        <Tooltip content={t('settings.provider.api.key.list.open')} delay={500}>
          <Button variant="ghost" size="icon-sm" onClick={onOpenApiKeyList}>
            <List size={14} />
          </Button>
        </Tooltip>
      </SettingSubtitle>
      <Flex className="gap-2">
        <Input.Password
          value={apiKey}
          placeholder={t('settings.provider.api_key.label')}
          onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
          onBlur={onUpdateApiKey}
          spellCheck={false}
          type="password"
          autoFocus={apiKey === ''}
        />
        <Button variant={apiValid ? 'ghost' : 'default'} onClick={onCheck} disabled={apiChecking}>
          {apiChecking ? <LoadingOutlined spin /> : apiValid ? <CheckOutlined /> : t('settings.tool.websearch.check')}
        </Button>
      </Flex>
      <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: 5 }}>
        <RowFlex>
          {apiKeyWebsite && (
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.provider.get_api_key')}
            </SettingHelpLink>
          )}
        </RowFlex>
        <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
      </SettingHelpTextRow>
    </>
  )
}

interface ApiHostSectionProps {
  apiHost: string
  onUpdateApiHost: () => void
  setApiHost: (value: string) => void
}

export const WebSearchProviderApiHostSection: FC<ApiHostSectionProps> = ({ apiHost, onUpdateApiHost, setApiHost }) => {
  const { t } = useTranslation()

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5, marginBottom: 10 }}>{t('settings.provider.api_host')}</SettingSubtitle>
      <Flex className="gap-2">
        <Input
          value={apiHost}
          placeholder={t('settings.provider.api_host')}
          onChange={(e) => setApiHost(e.target.value)}
          onBlur={onUpdateApiHost}
        />
      </Flex>
    </>
  )
}

interface BasicAuthSectionProps {
  basicAuthPassword: string
  basicAuthUsername: string
  onUpdateBasicAuthPassword: () => void
  onUpdateBasicAuthUsername: () => void
  setBasicAuthPassword: (value: string) => void
  setBasicAuthUsername: (value: string) => void
}

export const WebSearchProviderBasicAuthSection: FC<BasicAuthSectionProps> = ({
  basicAuthPassword,
  basicAuthUsername,
  onUpdateBasicAuthPassword,
  onUpdateBasicAuthUsername,
  setBasicAuthPassword,
  setBasicAuthUsername
}) => {
  const { t } = useTranslation()

  return (
    <>
      <SettingDivider style={{ marginTop: 12, marginBottom: 12 }} />
      <SettingSubtitle
        style={{
          marginTop: 5,
          marginBottom: 10,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center'
        }}>
        {t('settings.provider.basic_auth.label')}
        <InfoTooltip
          placement="right"
          content={t('settings.provider.basic_auth.tip')}
          iconProps={{
            size: 16,
            color: 'var(--color-icon)',
            className: 'ml-1 cursor-pointer'
          }}
        />
      </SettingSubtitle>
      <Form layout="vertical">
        <Form.Item label={t('settings.provider.basic_auth.user_name.label')}>
          <Input
            value={basicAuthUsername}
            onChange={(e) => setBasicAuthUsername(e.target.value)}
            onBlur={onUpdateBasicAuthUsername}
            placeholder={t('settings.provider.basic_auth.user_name.tip')}
            spellCheck={false}
          />
        </Form.Item>
        <Form.Item label={t('settings.provider.basic_auth.password.label')} style={{ marginBottom: 0 }}>
          <Input.Password
            value={basicAuthPassword}
            onChange={(e) => setBasicAuthPassword(e.target.value)}
            onBlur={onUpdateBasicAuthPassword}
            placeholder={t('settings.provider.basic_auth.password.tip')}
            spellCheck={false}
          />
        </Form.Item>
      </Form>
    </>
  )
}

const ProviderName = styled.span`
  font-size: 16px;
  font-weight: 500;
`
