import {
  Button,
  InfoTooltip,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { formatApiKeys } from '@renderer/utils'
import { Check, ExternalLink, Eye, EyeOff } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { WebSearchSettingsField, WebSearchSettingsHint, WebSearchSettingsSection } from './WebSearchSettingsLayout'

interface HeaderProps {
  logo?: string
  name?: string
  className?: string
  compact?: boolean
}

export const WebSearchProviderHeader: FC<HeaderProps> = ({ className, compact, logo, name }) => {
  return (
    <div
      className={cn('flex items-center justify-center text-foreground', compact ? 'gap-0' : 'gap-3 px-0', className)}>
      <img src={logo} alt={name} className={compact ? 'size-6 object-contain' : 'size-9 rounded-lg object-contain'} />
      {!compact && <span className="truncate font-semibold text-base text-foreground">{name}</span>}
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
    <WebSearchSettingsSection
      title={
        <span className="inline-flex items-center gap-1.5">
          {t('settings.tool.websearch.local_provider.settings')}
          <InfoTooltip
            placement="right"
            content={t('settings.tool.websearch.local_provider.hint')}
            iconProps={{
              size: 16,
              color: 'var(--color-icon)',
              className: 'cursor-pointer'
            }}
          />
        </span>
      }>
      <WebSearchSettingsField>
        <Button
          size="sm"
          className="bg-emerald-500 px-3 py-1.25 text-[10px] text-foreground shadow-none hover:bg-emerald-600"
          onClick={onOpenSettings}>
          <ExternalLink size={12} />
          {t('settings.tool.websearch.local_provider.open_settings', { provider: providerName })}
        </Button>
      </WebSearchSettingsField>
    </WebSearchSettingsSection>
  )
}

interface ApiKeySectionProps {
  apiChecking: boolean
  apiKey: string
  apiKeyProviderLabel: string
  apiKeyWebsite?: string
  apiValid: boolean
  onCheck: () => Promise<void>
  onUpdateApiKey: () => void
  setApiKey: (value: string) => void
}

export const WebSearchProviderApiKeySection: FC<ApiKeySectionProps> = ({
  apiChecking,
  apiKey,
  apiKeyProviderLabel,
  apiKeyWebsite,
  apiValid,
  onCheck,
  onUpdateApiKey,
  setApiKey
}) => {
  const { t } = useTranslation()
  const [showApiKey, setShowApiKey] = useState(false)

  return (
    <WebSearchSettingsSection title={t('settings.provider.api_key.label')}>
      <WebSearchSettingsField>
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <InputGroup className="border-border/30 bg-foreground/3 shadow-none">
              <InputGroupInput
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                placeholder={t('settings.provider.api_key.label')}
                onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
                onBlur={onUpdateApiKey}
                spellCheck={false}
                autoFocus={apiKey === ''}
                className="text-[10px]"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  variant="ghost"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowApiKey((value) => !value)}
                  className="text-foreground hover:text-foreground">
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <Button
              size="sm"
              className={cn(
                'px-3 py-1.25 text-[10px] shadow-none',
                apiValid
                  ? 'border border-emerald-500/20 bg-emerald-500/10 text-foreground hover:bg-emerald-500/15'
                  : 'bg-emerald-500 text-foreground hover:bg-emerald-600'
              )}
              onClick={onCheck}
              loading={apiChecking}>
              {!apiChecking && apiValid && <Check size={12} />}
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
                  className="text-[9px] text-foreground hover:underline">
                  <Trans
                    i18nKey="settings.tool.websearch.get_api_key"
                    values={{ providerId: apiKeyProviderLabel }}
                    components={{ provider: <span className="text-emerald-500/60" /> }}
                  />
                </a>
              )}
            </div>
            <WebSearchSettingsHint className="order-1 sm:order-2">
              {t('settings.provider.api_key.tip')}
            </WebSearchSettingsHint>
          </div>
        </div>
      </WebSearchSettingsField>
    </WebSearchSettingsSection>
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
    <WebSearchSettingsSection title={t('settings.provider.api_host')}>
      <WebSearchSettingsField>
        <Input
          value={apiHost}
          placeholder={t('settings.provider.api_host')}
          onChange={(e) => setApiHost(e.target.value)}
          onBlur={onUpdateApiHost}
          className="border-border/30 bg-foreground/3 text-[10px] shadow-none"
        />
      </WebSearchSettingsField>
    </WebSearchSettingsSection>
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
    <WebSearchSettingsSection
      title={
        <span className="inline-flex items-center gap-1.5">
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
        </span>
      }>
      <WebSearchSettingsField>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block font-medium text-[10px] text-foreground">
              {t('settings.provider.basic_auth.user_name.label')}
            </label>
            <Input
              value={basicAuthUsername}
              onChange={(e) => setBasicAuthUsername(e.target.value)}
              onBlur={onUpdateBasicAuthUsername}
              placeholder={t('settings.provider.basic_auth.user_name.tip')}
              spellCheck={false}
              className="border-border/30 bg-foreground/3 text-[10px] shadow-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block font-medium text-[10px] text-foreground">
              {t('settings.provider.basic_auth.password.label')}
            </label>
            <Input
              type="password"
              value={basicAuthPassword}
              onChange={(e) => setBasicAuthPassword(e.target.value)}
              onBlur={onUpdateBasicAuthPassword}
              placeholder={t('settings.provider.basic_auth.password.tip')}
              spellCheck={false}
              className="border-border/30 bg-foreground/3 text-[10px] shadow-none"
            />
          </div>
        </div>
      </WebSearchSettingsField>
    </WebSearchSettingsSection>
  )
}
