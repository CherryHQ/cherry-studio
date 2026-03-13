import { Button, InfoTooltip, Input, Tooltip } from '@cherrystudio/ui'
import { formatApiKeys } from '@renderer/utils'
import { Check, ExternalLink, List } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { WebSearchSettingsField, WebSearchSettingsHint } from './WebSearchSettingsLayout'

interface HeaderProps {
  logo?: string
  name?: string
  officialWebsite?: string
}

export const WebSearchProviderHeader: FC<HeaderProps> = ({ logo, name, officialWebsite }) => {
  if (officialWebsite) {
    return (
      <Button variant="ghost" size="icon-sm" asChild>
        <a href={officialWebsite} target="_blank" rel="noreferrer" aria-label={name ?? officialWebsite}>
          <ExternalLink />
        </a>
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {logo ? (
        <img src={logo} alt={name} className="h-9 w-9 rounded-lg object-contain" />
      ) : (
        <div className="h-9 w-9 rounded-lg bg-(--color-background-soft)" />
      )}
      <span className="truncate font-semibold text-(--color-text-1) text-base">{name}</span>
    </div>
  )
}

interface LocalSectionProps {
  onOpenSettings: () => Promise<void>
  providerName: string
}

export const WebSearchLocalProviderSection: FC<LocalSectionProps> = ({ onOpenSettings, providerName }) => {
  const { t } = useTranslation()

  return (
    <WebSearchSettingsField
      title={t('settings.tool.websearch.local_provider.settings')}
      description={t('settings.tool.websearch.local_provider.hint')}>
      <div className="flex justify-start lg:justify-end">
        <Button variant="default" onClick={onOpenSettings}>
          <ExternalLink />
          {t('settings.tool.websearch.local_provider.open_settings', { provider: providerName })}
        </Button>
      </div>
    </WebSearchSettingsField>
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
    <WebSearchSettingsField
      title={
        <span className="flex items-center gap-2">
          <span>{t('settings.provider.api_key.label')}</span>
          <Tooltip content={t('settings.provider.api.key.list.open')} delay={500}>
            <Button variant="ghost" size="icon-sm" onClick={onOpenApiKeyList}>
              <List size={14} />
            </Button>
          </Tooltip>
        </span>
      }>
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="password"
            value={apiKey}
            placeholder={t('settings.provider.api_key.label')}
            onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
            onBlur={onUpdateApiKey}
            spellCheck={false}
            autoFocus={apiKey === ''}
            className="flex-1"
          />
          <Button variant={apiValid ? 'outline' : 'default'} onClick={onCheck} loading={apiChecking}>
            {!apiChecking && apiValid && <Check />}
            {t('settings.tool.websearch.check')}
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="order-2 sm:order-1">
            {apiKeyWebsite && (
              <a
                target="_blank"
                rel="noreferrer"
                href={apiKeyWebsite}
                className="text-(--color-primary) text-xs hover:underline">
                {t('settings.provider.get_api_key')}
              </a>
            )}
          </div>
          <WebSearchSettingsHint className="order-1 sm:order-2">
            {t('settings.provider.api_key.tip')}
          </WebSearchSettingsHint>
        </div>
      </div>
    </WebSearchSettingsField>
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
    <WebSearchSettingsField title={t('settings.provider.api_host')}>
      <Input
        value={apiHost}
        placeholder={t('settings.provider.api_host')}
        onChange={(e) => setApiHost(e.target.value)}
        onBlur={onUpdateApiHost}
      />
    </WebSearchSettingsField>
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
    <WebSearchSettingsField
      title={
        <>
          {t('settings.provider.basic_auth.label')}
          <InfoTooltip
            placement="right"
            content={t('settings.provider.basic_auth.tip')}
            iconProps={{
              size: 16,
              color: 'var(--color-icon)',
              className: 'cursor-pointer'
            }}
          />
        </>
      }
      description={t('settings.provider.basic_auth.tip')}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block font-medium text-(--color-text-2) text-xs">
            {t('settings.provider.basic_auth.user_name.label')}
          </label>
          <Input
            value={basicAuthUsername}
            onChange={(e) => setBasicAuthUsername(e.target.value)}
            onBlur={onUpdateBasicAuthUsername}
            placeholder={t('settings.provider.basic_auth.user_name.tip')}
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <label className="block font-medium text-(--color-text-2) text-xs">
            {t('settings.provider.basic_auth.password.label')}
          </label>
          <Input
            type="password"
            value={basicAuthPassword}
            onChange={(e) => setBasicAuthPassword(e.target.value)}
            onBlur={onUpdateBasicAuthPassword}
            placeholder={t('settings.provider.basic_auth.password.tip')}
            spellCheck={false}
          />
        </div>
      </div>
    </WebSearchSettingsField>
  )
}
