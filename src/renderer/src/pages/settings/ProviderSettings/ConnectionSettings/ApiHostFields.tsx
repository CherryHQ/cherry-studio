import { Button, InputGroup, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Copy, RotateCcw, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import ProviderField from '../primitives/ProviderField'
import ProviderSection from '../primitives/ProviderSection'
import { fieldClasses } from '../primitives/ProviderSettingsPrimitives'
import CherryINSettings from '../ProviderSpecific/CherryINSettings'
import { copyApiKeyToClipboard } from './copyApiKeyToClipboard'

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
  const trimmedApiHost = apiHost.trim()

  return (
    <ProviderField
      title={t('settings.provider.api_host')}
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
        <div className={cn(fieldClasses.inputRow, 'group')}>
          <InputGroup className={`${fieldClasses.inputGroup} min-w-0 flex-1`}>
            <div
              role="presentation"
              className={cn(
                fieldClasses.input,
                'flex min-h-[1.25em] min-w-0 flex-1 items-center gap-1 bg-transparent py-0'
              )}
              title={trimmedApiHost}>
              <span className="block min-w-0 flex-1 cursor-default truncate font-mono tabular-nums">
                {trimmedApiHost ? trimmedApiHost : t('settings.provider.api_host_placeholder')}
              </span>
              {trimmedApiHost ? (
                <Tooltip content={t('common.copy')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-5 shrink-0 rounded-md p-0 text-muted-foreground/35 opacity-0 shadow-none transition-opacity hover:bg-accent/50 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={t('common.copy')}
                    onClick={() => void copyApiKeyToClipboard(trimmedApiHost, t)}>
                    <Copy className="size-2.5" />
                  </Button>
                </Tooltip>
              ) : null}
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
  const trimmedAnthropicApiHost = anthropicApiHost.trim()

  return (
    <ProviderField
      title={t('settings.provider.anthropic_api_host')}
      help={
        <div className="break-all pt-1 text-[12px] text-foreground/55 leading-[1.35]">
          {t('settings.provider.anthropic_api_host_preview', { url: anthropicHostPreview || '—' })}
        </div>
      }>
      <div className={cn(fieldClasses.inputRow, 'group')}>
        <InputGroup className={`${fieldClasses.inputGroupBlock} flex-1 items-center`}>
          <div
            role="presentation"
            className={cn(
              fieldClasses.input,
              'flex min-h-[1.25em] min-w-0 flex-1 items-center gap-1 bg-transparent py-0'
            )}
            title={trimmedAnthropicApiHost}>
            <span className="block min-w-0 flex-1 cursor-default truncate font-mono tabular-nums">
              {trimmedAnthropicApiHost ? trimmedAnthropicApiHost : t('settings.provider.api_host_placeholder')}
            </span>
            {trimmedAnthropicApiHost ? (
              <Tooltip content={t('common.copy')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-5 shrink-0 rounded-md p-0 text-muted-foreground/35 opacity-0 shadow-none transition-opacity hover:bg-accent/50 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={t('common.copy')}
                  onClick={() => void copyApiKeyToClipboard(trimmedAnthropicApiHost, t)}>
                  <Copy className="size-2.5" />
                </Button>
              </Tooltip>
            ) : null}
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
