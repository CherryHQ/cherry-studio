import { HelpTooltip, InputGroup, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { RotateCcw, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import CherryINSettings from '../ProviderSpecific/CherryINSettings'
import ProviderField from '../shared/primitives/ProviderField'
import ProviderSection from '../shared/primitives/ProviderSection'
import { fieldClasses } from '../shared/primitives/ProviderSettingsPrimitives'

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
  isCherryIN: boolean
  isChineseUser: boolean
  isVertexAI: boolean
  isApiHostResettable: boolean
  onResetApiHost: () => void
  onOpenRequestConfig: () => void
}

export function ApiHostField({
  providerIdForSettings,
  apiHost,
  isCherryIN,
  isChineseUser,
  isVertexAI,
  isApiHostResettable,
  onResetApiHost,
  onOpenRequestConfig
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
          <InputGroup className={`${fieldClasses.inputGroup} min-w-0 flex-1`}>
            <div
              role="presentation"
              className={cn(
                fieldClasses.input,
                'block min-h-[1.25em] min-w-0 flex-1 cursor-default truncate bg-transparent py-0 font-mono tabular-nums'
              )}
              title={apiHost.trim()}>
              {apiHost.trim() ? apiHost.trim() : t('settings.provider.api_host_placeholder')}
            </div>
          </InputGroup>
          <div className="inline-flex shrink-0 items-center gap-1">
            {isApiHostResettable ? (
              <Tooltip content={t('settings.provider.api.url.reset')}>
                <span className="inline-flex shrink-0">
                  <button
                    type="button"
                    className={fieldClasses.iconButton}
                    aria-label={t('settings.provider.api.url.reset')}
                    onClick={() => {
                      onResetApiHost()
                    }}>
                    <RotateCcw size={12} />
                  </button>
                </span>
              </Tooltip>
            ) : null}
            <Tooltip content={t('settings.provider.request_configuration_tooltip')}>
              <span className="inline-flex shrink-0">
                <button
                  type="button"
                  className={fieldClasses.iconButton}
                  aria-label={t('settings.provider.request_configuration_tooltip')}
                  onClick={onOpenRequestConfig}>
                  <Settings size={12} aria-hidden />
                </button>
              </span>
            </Tooltip>
          </div>
        </div>
      )}
    </ProviderField>
  )
}

interface AnthropicApiHostFieldProps {
  anthropicApiHost: string
  anthropicHostPreview: string
  onOpenRequestConfig: () => void
}

export function AnthropicApiHostField({
  anthropicApiHost,
  anthropicHostPreview,
  onOpenRequestConfig
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
      <div className={fieldClasses.inputRow}>
        <InputGroup className={`${fieldClasses.inputGroupBlock} flex-1 items-center`}>
          <div
            role="presentation"
            className={cn(
              fieldClasses.input,
              'block min-h-[1.25em] min-w-0 flex-1 cursor-default truncate bg-transparent py-0 font-mono tabular-nums'
            )}
            title={anthropicApiHost.trim()}>
            {anthropicApiHost.trim() ? anthropicApiHost.trim() : t('settings.provider.api_host_placeholder')}
          </div>
        </InputGroup>
        <Tooltip content={t('settings.provider.request_configuration_tooltip')}>
          <span className="inline-flex shrink-0">
            <button
              type="button"
              className={fieldClasses.iconButton}
              aria-label={t('settings.provider.request_configuration_tooltip')}
              onClick={onOpenRequestConfig}>
              <Settings size={12} aria-hidden />
            </button>
          </span>
        </Tooltip>
      </div>
    </ProviderField>
  )
}

export function ApiHostSection({ children }: { children: React.ReactNode }) {
  return <ProviderSection>{children}</ProviderSection>
}
