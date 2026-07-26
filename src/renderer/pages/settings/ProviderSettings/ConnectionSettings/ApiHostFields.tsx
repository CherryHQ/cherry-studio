import { Button, InputGroup, InputGroupAddon, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { Copy, RotateCcw, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import ProviderField from '../primitives/ProviderField'
import ProviderSection from '../primitives/ProviderSection'
import { fieldClasses } from '../primitives/ProviderSettingsPrimitives'
import CherryInSettings from '../ProviderSpecific/CherryInSettings'
import { copyApiKeyToClipboard } from './copyApiKeyToClipboard'

function ApiHostEndpointButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const label = t('settings.provider.more_endpoints.add')

  return (
    <button type="button" aria-label={label} className={fieldClasses.titleHelpLink} onClick={onClick}>
      {label}
    </button>
  )
}

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
  onApiHostChange: (value: string) => void
  onApiHostCommit: () => void
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
  onApiHostChange,
  onApiHostCommit,
  onResetApiHost,
  onOpenRequestConfig
}: ApiHostFieldProps) {
  const { t } = useTranslation()
  const trimmedApiHost = apiHost.trim()
  const help = isVertexAI ? (
    <div className="space-y-1 pt-1">
      <div className="text-[12px] text-foreground/55 leading-[1.35]">
        {t('settings.provider.vertex_ai.api_host_help')}
      </div>
    </div>
  ) : undefined

  return (
    <ProviderField
      title={
        <span className={fieldClasses.titleWithHelp}>
          <span className="font-semibold">{t('settings.provider.api_host')}</span>
          <ApiHostEndpointButton onClick={onOpenRequestConfig} />
        </span>
      }
      titleClassName="text-foreground"
      help={help}>
      {isCherryIN && isChineseUser ? (
        <div className={cn(fieldClasses.inputRow, 'group')}>
          <div className="flex min-w-0 flex-1">
            <CherryInSettings providerId={providerIdForSettings} />
          </div>
          <Tooltip content={t('settings.provider.request_configuration_tooltip')}>
            <span className="inline-flex shrink-0">
              <button
                type="button"
                className={fieldClasses.inputActionButton}
                aria-label={t('settings.provider.request_configuration_tooltip')}
                onClick={onOpenRequestConfig}>
                <Settings size={14} aria-hidden />
              </button>
            </span>
          </Tooltip>
        </div>
      ) : (
        <div className={cn(fieldClasses.inputRow, 'group')}>
          <InputGroup className={`${fieldClasses.inputGroup} min-w-0 flex-1`}>
            <InputGroupInput
              className={cn(fieldClasses.input, 'font-mono tabular-nums')}
              value={apiHost}
              placeholder={t('settings.provider.api_host_placeholder')}
              aria-label={t('settings.provider.api_host')}
              title={trimmedApiHost}
              onChange={(event) => onApiHostChange(event.target.value)}
              onBlur={onApiHostCommit}
              autoComplete="off"
            />
            {trimmedApiHost ? (
              <InputGroupAddon align="inline-end" className="-mr-0.5 pr-0">
                <Tooltip content={t('common.copy')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-5 shrink-0 rounded-md p-0 text-muted-foreground/35 opacity-0 shadow-none transition-opacity hover:bg-accent/50 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={t('common.copy')}
                    onClick={() => {
                      void copyApiKeyToClipboard(trimmedApiHost, t)
                    }}>
                    <Copy className="size-2.5" />
                  </Button>
                </Tooltip>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          {isApiHostResettable ? (
            <Tooltip content={t('settings.provider.api.url.reset')}>
              <span className="inline-flex shrink-0">
                <button
                  type="button"
                  className={fieldClasses.inputActionButton}
                  aria-label={t('settings.provider.api.url.reset')}
                  onClick={() => {
                    onResetApiHost()
                  }}>
                  <RotateCcw size={14} />
                </button>
              </span>
            </Tooltip>
          ) : null}
          <Tooltip content={t('settings.provider.request_configuration_tooltip')}>
            <span className="inline-flex shrink-0">
              <button
                type="button"
                className={fieldClasses.inputActionButton}
                aria-label={t('settings.provider.request_configuration_tooltip')}
                onClick={onOpenRequestConfig}>
                <Settings size={14} aria-hidden />
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
  anthropicHostPreview: string
  onAnthropicApiHostChange: (value: string) => void
  onAnthropicApiHostCommit: () => void
  onOpenRequestConfig: () => void
}

export function AnthropicApiHostField({
  anthropicApiHost,
  anthropicHostPreview,
  onAnthropicApiHostChange,
  onAnthropicApiHostCommit,
  onOpenRequestConfig
}: AnthropicApiHostFieldProps) {
  const { t } = useTranslation()
  const trimmedAnthropicApiHost = anthropicApiHost.trim()

  return (
    <ProviderField
      title={
        <span className={fieldClasses.titleWithHelp}>
          <span className="font-semibold">{t('settings.provider.anthropic_api_host')}</span>
          <ApiHostEndpointButton onClick={onOpenRequestConfig} />
        </span>
      }
      help={
        <div className="break-all pt-1 text-[12px] text-foreground/55 leading-[1.35]">
          {t('settings.provider.anthropic_api_host_preview', { url: anthropicHostPreview || '—' })}
        </div>
      }>
      <div className={cn(fieldClasses.inputRow, 'group')}>
        <InputGroup className={`${fieldClasses.inputGroup} min-w-0 flex-1`}>
          <InputGroupInput
            className={cn(fieldClasses.input, 'font-mono tabular-nums')}
            value={anthropicApiHost}
            placeholder={t('settings.provider.api_host_placeholder')}
            aria-label={t('settings.provider.anthropic_api_host')}
            title={trimmedAnthropicApiHost}
            onChange={(event) => onAnthropicApiHostChange(event.target.value)}
            onBlur={onAnthropicApiHostCommit}
            autoComplete="off"
          />
          {trimmedAnthropicApiHost ? (
            <InputGroupAddon align="inline-end" className="-mr-0.5 pr-0">
              <Tooltip content={t('common.copy')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-5 shrink-0 rounded-md p-0 text-muted-foreground/35 opacity-0 shadow-none transition-opacity hover:bg-accent/50 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={t('common.copy')}
                  onClick={() => {
                    void copyApiKeyToClipboard(trimmedAnthropicApiHost, t)
                  }}>
                  <Copy className="size-2.5" />
                </Button>
              </Tooltip>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <Tooltip content={t('settings.provider.request_configuration_tooltip')}>
          <span className="inline-flex shrink-0">
            <button
              type="button"
              className={fieldClasses.inputActionButton}
              aria-label={t('settings.provider.request_configuration_tooltip')}
              onClick={onOpenRequestConfig}>
              <Settings size={14} aria-hidden />
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
