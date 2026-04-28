import { HelpTooltip, InputGroup, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import CherryINSettings from '@renderer/pages/settings/ProviderSettingsV2/CherryINSettings'
import { RotateCcw, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import ProviderField from './ProviderField'
import ProviderSection from './ProviderSection'
import { fieldClasses } from './ProviderSettingsPrimitives'

interface AzureApiVersionFieldProps {
  className?: string
  apiVersion: string
  onApiVersionChange: (value: string) => void
  onApiVersionCommit: () => void
}

export function AzureApiVersionField({
  className,
  apiVersion,
  onApiVersionChange,
  onApiVersionCommit
}: AzureApiVersionFieldProps) {
  const { t } = useTranslation()

  return (
    <ProviderField
      className={className}
      title={t('settings.provider.api_version')}
      help={
        <div className="pt-1 text-[12px] text-foreground/55 leading-[1.35]">
          {t('settings.provider.azure.apiversion.tip')}
        </div>
      }>
      <InputGroup className={fieldClasses.inputGroupBlock}>
        <InputGroupInput
          className={fieldClasses.input}
          value={apiVersion}
          placeholder="2024-xx-xx-preview"
          onChange={(event) => onApiVersionChange(event.target.value)}
          onBlur={onApiVersionCommit}
        />
      </InputGroup>
    </ProviderField>
  )
}

interface ApiHostFieldProps {
  providerIdForSettings: string
  apiHost: string
  setApiHost: (value: string) => void
  hostPreview: string
  isApiHostResettable: boolean
  isCherryIN: boolean
  isChineseUser: boolean
  isVertexAI: boolean
  onCommitApiHost: () => void
  onResetApiHost: () => void
  onOpenCustomHeaders: () => void
}

export function ApiHostField({
  providerIdForSettings,
  apiHost,
  setApiHost,
  hostPreview,
  isApiHostResettable,
  isCherryIN,
  isChineseUser,
  isVertexAI,
  onCommitApiHost,
  onResetApiHost,
  onOpenCustomHeaders
}: ApiHostFieldProps) {
  const { t } = useTranslation()

  return (
    <ProviderField
      title={
        <div className="flex items-center gap-1">
          <span>{`${t('settings.provider.api_host')} (Endpoint URL)`}</span>
          <HelpTooltip title={t('settings.provider.api.url.tip')} />
        </div>
      }
      help={
        <div className="space-y-1 pt-1">
          {isVertexAI && (
            <div className="text-[12px] text-foreground/55 leading-[1.35]">
              {t('settings.provider.vertex_ai.api_host_help')}
            </div>
          )}
          {/* <div className="break-all text-[12px] text-foreground/55 leading-[1.35]">
            {t('settings.provider.api_host_preview', { url: hostPreview })}
          </div> */}
        </div>
      }>
      {isCherryIN && isChineseUser ? (
        <CherryINSettings providerId={providerIdForSettings} />
      ) : (
        <div className={fieldClasses.inputRow}>
          <InputGroup className={fieldClasses.inputGroup}>
            <InputGroupInput
              className={fieldClasses.input}
              value={apiHost}
              placeholder={t('settings.provider.api_host')}
              onChange={(event) => setApiHost(event.target.value)}
              onBlur={onCommitApiHost}
            />
          </InputGroup>
          {isApiHostResettable ? (
            <Tooltip content={t('settings.provider.api.url.reset')}>
              <span className="inline-flex shrink-0">
                <button
                  type="button"
                  aria-label={t('settings.provider.api.url.reset')}
                  className={fieldClasses.iconButton}
                  onClick={onResetApiHost}>
                  <RotateCcw size={12} />
                </button>
              </span>
            </Tooltip>
          ) : null}
          <Tooltip content={t('settings.provider.copilot.custom_headers')}>
            <span className={fieldClasses.inputRowEndSlot}>
              <button type="button" className={fieldClasses.iconButton} onClick={onOpenCustomHeaders}>
                <Settings2 size={12} />
              </button>
            </span>
          </Tooltip>
        </div>
      )}
    </ProviderField>
  )
}

interface AnthropicApiHostFieldProps {
  anthropicApiHost: string
  setAnthropicApiHost: (value: string) => void
  anthropicHostPreview: string
  onCommitAnthropicApiHost: () => void
}

export function AnthropicApiHostField({
  anthropicApiHost,
  setAnthropicApiHost,
  anthropicHostPreview,
  onCommitAnthropicApiHost
}: AnthropicApiHostFieldProps) {
  const { t } = useTranslation()

  return (
    <ProviderField
      title={
        <div className="flex items-center gap-1">
          <span>{t('settings.provider.anthropic_api_host')}</span>
          <HelpTooltip title={t('settings.provider.api.url.tip')} />
        </div>
      }
      help={
        <div className="break-all pt-1 text-[12px] text-foreground/55 leading-[1.35]">
          {t('settings.provider.anthropic_api_host_preview', { url: anthropicHostPreview || '—' })}
        </div>
      }>
      <InputGroup className={fieldClasses.inputGroupBlock}>
        <InputGroupInput
          className={fieldClasses.input}
          value={anthropicApiHost}
          placeholder={t('settings.provider.anthropic_api_host')}
          onChange={(event) => setAnthropicApiHost(event.target.value)}
          onBlur={onCommitAnthropicApiHost}
        />
      </InputGroup>
    </ProviderField>
  )
}

export function ApiHostSection({ children }: { children: React.ReactNode }) {
  return <ProviderSection>{children}</ProviderSection>
}
