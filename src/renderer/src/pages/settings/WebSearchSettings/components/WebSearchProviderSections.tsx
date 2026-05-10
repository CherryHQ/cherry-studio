import { Badge, Button, InfoTooltip, Tooltip } from '@cherrystudio/ui'
import { WEB_SEARCH_PROVIDER_CONFIG } from '@renderer/config/webSearchProviders'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { ExternalLink, List, ServerCog } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { ResolvedWebSearchProviderCapability } from '../utils/webSearchProviderMeta'
import { PasswordField, TextField } from './Field'
import { SettingsHelpIcon, SettingsSection } from './SettingsSection'

type ProviderDefaultActionProps = {
  isDefault: boolean
  canSetAsDefault: boolean
  onSetAsDefault: () => void
}

export function ProviderDefaultAction({ isDefault, canSetAsDefault, onSetAsDefault }: ProviderDefaultActionProps) {
  const { t } = useTranslation()

  if (isDefault) {
    return (
      <Badge className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 text-xs leading-tight shadow-none dark:text-emerald-400">
        {t('common.default')}
      </Badge>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 rounded-lg px-3"
      disabled={!canSetAsDefault}
      onClick={onSetAsDefault}>
      {t('settings.tool.websearch.set_as_default')}
    </Button>
  )
}

type LlmProviderApiKeySectionProps = {
  onOpenProviderSettings: () => void
}

export function LlmProviderApiKeySection({ onOpenProviderSettings }: LlmProviderApiKeySectionProps) {
  const { t } = useTranslation()

  return (
    <SettingsSection title={t('settings.provider.api_key.label')}>
      <Button variant="outline" size="sm" className="h-7 rounded-lg px-3" onClick={onOpenProviderSettings}>
        <ExternalLink className="size-3" />
        {t('navigate.provider_settings')}
      </Button>
    </SettingsSection>
  )
}

type ProviderApiKeySectionProps = {
  provider: ResolvedWebSearchProvider
  apiKeys: string[]
  apiKeyInput: string
  onChange: (value: string) => void
  onBlur: () => void
  onOpenApiKeyList: () => void
}

export function ProviderApiKeySection({
  provider,
  apiKeys,
  apiKeyInput,
  onChange,
  onBlur,
  onOpenApiKeyList
}: ProviderApiKeySectionProps) {
  const { t } = useTranslation()
  const apiKeyWebsite = WEB_SEARCH_PROVIDER_CONFIG[provider.id]?.websites?.apiKey

  return (
    <SettingsSection title={t('settings.provider.api_key.label')}>
      <PasswordField
        label={t('settings.provider.api_key.label')}
        value={apiKeyInput}
        placeholder={t('settings.provider.api_key.label')}
        onChange={onChange}
        onBlur={onBlur}
        autoFocus={apiKeys.length === 0}
        hideLabel={t('common.close')}
        showLabel={t('common.open')}
        action={
          <Tooltip content={t('settings.provider.api.key.list.open')} delay={500}>
            <button
              type="button"
              className="shrink-0 text-muted-foreground/25 hover:text-muted-foreground/50"
              onClick={onOpenApiKeyList}>
              <List className="size-3" />
            </button>
          </Tooltip>
        }
      />
      <div className="flex items-center justify-between gap-3">
        {apiKeyWebsite ? (
          <a
            target="_blank"
            rel="noreferrer"
            href={apiKeyWebsite}
            className="text-emerald-500 text-xs leading-tight hover:underline">
            {t('settings.provider.get_api_key')}
          </a>
        ) : (
          <span />
        )}
        <span className="text-foreground/35 text-xs leading-tight">{t('settings.provider.api_key.tip')}</span>
      </div>
    </SettingsSection>
  )
}

type ProviderApiHostSectionProps = {
  apiHosts: Record<string, string>
  capabilities: ResolvedWebSearchProviderCapability[]
  onChange: (feature: string, value: string) => void
  onBlur: (capability: ResolvedWebSearchProviderCapability) => void
}

export function ProviderApiHostSection({ apiHosts, capabilities, onChange, onBlur }: ProviderApiHostSectionProps) {
  const { t } = useTranslation()

  return (
    <SettingsSection title={t('settings.provider.api_host')}>
      {capabilities.map((capability) => (
        <TextField
          key={capability.feature}
          value={apiHosts[capability.feature] ?? ''}
          placeholder={t('settings.provider.api_host')}
          onChange={(value) => onChange(capability.feature, value)}
          onBlur={() => onBlur(capability)}
        />
      ))}
    </SettingsSection>
  )
}

type ProviderBasicAuthSectionProps = {
  username: string
  password: string
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onUsernameBlur: () => void
  onPasswordBlur: () => void
}

export function ProviderBasicAuthSection({
  username,
  password,
  onUsernameChange,
  onPasswordChange,
  onUsernameBlur,
  onPasswordBlur
}: ProviderBasicAuthSectionProps) {
  const { t } = useTranslation()

  return (
    <SettingsSection
      title={t('settings.provider.basic_auth.label')}
      badge={
        <SettingsHelpIcon>
          <InfoTooltip
            placement="right"
            content={t('settings.provider.basic_auth.tip')}
            iconProps={{ size: 10, color: 'currentColor', className: 'cursor-pointer' }}
          />
        </SettingsHelpIcon>
      }>
      <TextField
        label={t('settings.provider.basic_auth.user_name.label')}
        value={username}
        placeholder={t('settings.provider.basic_auth.user_name.tip')}
        onChange={onUsernameChange}
        onBlur={onUsernameBlur}
      />
      {username ? (
        <PasswordField
          label={t('settings.provider.basic_auth.password.label')}
          value={password}
          placeholder={t('settings.provider.basic_auth.password.tip')}
          onChange={onPasswordChange}
          onBlur={onPasswordBlur}
          hideLabel={t('common.close')}
          showLabel={t('common.open')}
        />
      ) : null}
    </SettingsSection>
  )
}

type FreeProviderNoticeProps = {
  children?: ReactNode
}

export function FreeProviderNotice({ children }: FreeProviderNoticeProps) {
  const { t } = useTranslation()

  return (
    <SettingsSection title={t('settings.tool.websearch.search_provider')}>
      <div className="flex items-center gap-2 rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] px-3 py-2.5 text-foreground/45 text-xs leading-tight">
        <ServerCog className="size-3.5" />
        <span>{children ?? t('settings.tool.websearch.free')}</span>
      </div>
    </SettingsSection>
  )
}
