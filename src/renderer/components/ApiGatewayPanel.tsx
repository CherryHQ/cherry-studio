import { ExternalLink, Eye, EyeOff, Play, RotateCcw, Square } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'

import {
  Button,
  IndicatorLight,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputNumber,
  Tooltip
} from '@cherrystudio/ui'
import CopyButton from '@renderer/components/CopyButton'
import { GatewayIcon } from '@renderer/components/icons/GatewayIcon'
import { SettingGroup, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { useTheme } from '@renderer/hooks/useTheme'
import { toast } from '@renderer/services/toast'
import { openExternalWebsite } from '@renderer/services/website'
import { cn } from '@renderer/utils/style'
import { gatewayClientOrigin } from '@shared/utils/apiGateway'

const API_SERVER_DEFAULTS = {
  HOST: '127.0.0.1',
  PORT: 23333
}

const PORT_MIN = 1000
const PORT_MAX = 65535

const ApiGatewayPanel: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const [visibility, setVisibility] = useState<{ key: string; visible: boolean }>({ key: '', visible: false })

  // API Gateway state from useApiGateway hook
  const {
    apiGatewayConfig,
    apiGatewayRunning,
    apiGatewayEndpoint,
    apiGatewayLoading,
    startApiGateway,
    stopApiGateway,
    restartApiGateway,
    setApiGatewayConfig
  } = useApiGateway()

  // 0.0.0.0 is a bind address, not a reachable one — render the loopback URL instead
  // (LAN URLs live in Device Connections settings).
  const serverHost =
    (apiGatewayRunning && apiGatewayEndpoint?.host) || apiGatewayConfig.host || API_SERVER_DEFAULTS.HOST
  const serverPort =
    (apiGatewayRunning && apiGatewayEndpoint?.port) || apiGatewayConfig.port || API_SERVER_DEFAULTS.PORT
  const serverUrl = gatewayClientOrigin(serverHost, serverPort)
  const apiKey = apiGatewayConfig.apiKey || ''
  const apiKeyVisible = visibility.key === apiKey && visibility.visible
  if (visibility.key !== apiKey) setVisibility({ key: apiKey, visible: false })
  const authorizationHeader = `Authorization: Bearer ${apiKey || 'your-api-key'}`

  const handleApiGatewayToggle = async (enabled: boolean) => {
    // `startApiGateway`/`stopApiGateway` already persist `enabled` on success and
    // toast on failure. Do not force-write `enabled` here — a failed start must not
    // leave the preference (and Main's lifecycle) believing the gateway is enabled.
    if (enabled) {
      await startApiGateway()
    } else {
      await stopApiGateway()
    }
  }

  const handleApiGatewayRestart = async () => {
    await restartApiGateway()
  }

  const generateApiKey = () => {
    return `cs-sk-${uuidv4()}`
  }

  const regenerateApiKey = () => {
    void setApiGatewayConfig({ apiKey: generateApiKey() })
    toast.success(t('apiGateway.messages.apiKeyRegenerated'))
  }

  // A port is an identifier, not a magnitude, so the field is given no `min`/`max`
  // to clamp against: 999 must be refused, not silently turned into 1000.
  const handlePortChange = (value: number | null) => {
    // Emptying the field is how you retype it, not how you unset the port — the
    // gateway always needs one. The field snaps back to the saved value on blur.
    if (value === null) return
    if (value < PORT_MIN || value > PORT_MAX) {
      toast.error(t('apiGateway.messages.portInvalid', { min: PORT_MIN, max: PORT_MAX }))
      return
    }
    void setApiGatewayConfig({ port: value })
  }

  const openApiDocs = () => {
    if (apiGatewayRunning) {
      // The ElysiaJS `@elysia/openapi` plugin serves the docs UI at `/openapi`
      // (the Express `/api-docs` path was removed in the gateway migration).
      void openExternalWebsite(`${serverUrl}/openapi`)
    }
  }

  return (
    <div data-ui="api-gateway.panel">
      <StatusCard $running={apiGatewayRunning}>
        <StatusSection>
          <StatusIcon $running={apiGatewayRunning}>
            <GatewayIcon width={22} height={22} />
          </StatusIcon>
          <StatusContent>
            <StatusLabel>
              <IndicatorLight
                color={apiGatewayRunning ? 'var(--success)' : 'var(--muted-foreground)'}
                size={8}
                animation={apiGatewayRunning}
                shadow={apiGatewayRunning}
              />
              <StatusText $running={apiGatewayRunning}>
                {apiGatewayRunning ? t('apiGateway.status.running') : t('apiGateway.status.stopped')}
              </StatusText>
            </StatusLabel>
            <StatusSubtext>{apiGatewayRunning ? serverUrl : t('apiGateway.messages.notEnabled')}</StatusSubtext>
          </StatusContent>
        </StatusSection>
        <StatusActions>
          {apiGatewayRunning && (
            <Button variant="outline" aria-label={t('apiGateway.documentation.title')} onClick={openApiDocs}>
              <ExternalLink size={13} />
              {/* 141px label + 16px icon + 6px gap + 20px padding + borders need about 190px. */}
              <span className="@max-[190px]/actions:hidden">{t('apiGateway.documentation.title')}</span>
            </Button>
          )}
          {apiGatewayRunning && (
            <Tooltip title={t('apiGateway.actions.restart.tooltip')}>
              <Button variant="outline" loading={apiGatewayLoading} onClick={handleApiGatewayRestart}>
                {!apiGatewayLoading && <RotateCcw size={14} />}
                {t('apiGateway.actions.restart.button')}
              </Button>
            </Tooltip>
          )}
          {apiGatewayRunning ? (
            <Button variant="outline" loading={apiGatewayLoading} onClick={() => handleApiGatewayToggle(false)}>
              {!apiGatewayLoading && <Square size={14} />}
              {t('apiGateway.actions.stop')}
            </Button>
          ) : (
            <Button loading={apiGatewayLoading} onClick={() => handleApiGatewayToggle(true)}>
              {!apiGatewayLoading && <Play size={14} />}
              {t('apiGateway.actions.start')}
            </Button>
          )}
        </StatusActions>
      </StatusCard>
      <Sections>
        <SettingGroup theme={theme} className="mt-0 overflow-hidden p-0">
          <ConnectionFields className={apiGatewayRunning ? 'grid-cols-1' : undefined}>
            <Field className="min-w-0">
              <SettingRowTitle>{t('apiGateway.fields.url.label')}</SettingRowTitle>
              <InputGroup className="mt-2 min-w-0">
                <InputGroupInput
                  className="font-mono text-xs"
                  aria-label={t('apiGateway.fields.url.label')}
                  value={serverUrl}
                  readOnly
                />
                <InputGroupAddon align="inline-end">
                  <Tooltip content={t('apiGateway.fields.url.copyTooltip')}>
                    <InputGroupButton size="icon-xs" asChild>
                      <CopyButton
                        textToCopy={serverUrl}
                        size={16}
                        aria-label={t('apiGateway.fields.url.copyTooltip')}
                        successFeedback="icon"
                      />
                    </InputGroupButton>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            {!apiGatewayRunning && (
              <Field>
                <SettingRowTitle>{t('apiGateway.fields.port.label')}</SettingRowTitle>
                <InputNumber
                  className="mt-2 w-full font-mono text-xs tabular-nums"
                  aria-label={t('apiGateway.fields.port.label')}
                  step={1}
                  value={serverPort}
                  onBlur={handlePortChange}
                />
              </Field>
            )}
          </ConnectionFields>
        </SettingGroup>

        <SettingGroup theme={theme} className="mt-0 overflow-hidden p-0">
          <CredentialFields>
            <Field>
              <SettingRowTitle>{t('apiGateway.fields.apiKey.label')}</SettingRowTitle>
              <InputGroup className="mt-2 min-w-0">
                <InputGroupInput
                  className="font-mono text-xs"
                  aria-label={t('apiGateway.fields.apiKey.label')}
                  type={apiKeyVisible ? 'text' : 'password'}
                  value={apiKey}
                  readOnly
                  placeholder={t('apiGateway.fields.apiKey.placeholder')}
                />
                <InputGroupAddon align="inline-end">
                  {!apiGatewayRunning && (
                    <Tooltip content={t('apiGateway.actions.regenerate')}>
                      <InputGroupButton
                        size="icon-xs"
                        aria-label={t('apiGateway.actions.regenerate')}
                        onClick={regenerateApiKey}>
                        <RotateCcw />
                      </InputGroupButton>
                    </Tooltip>
                  )}
                  <Tooltip
                    content={t(
                      apiKeyVisible ? 'settings.provider.api_key.hide_key' : 'settings.provider.api_key.show_key'
                    )}>
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={t(
                        apiKeyVisible ? 'settings.provider.api_key.hide_key' : 'settings.provider.api_key.show_key'
                      )}
                      onClick={() => setVisibility({ key: apiKey, visible: !apiKeyVisible })}
                      disabled={!apiKey}>
                      {apiKeyVisible ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </Tooltip>
                  <Tooltip content={t('apiGateway.fields.apiKey.copyTooltip')}>
                    <InputGroupButton size="icon-xs" asChild>
                      <CopyButton
                        textToCopy={apiKey}
                        size={16}
                        aria-label={t('apiGateway.fields.apiKey.copyTooltip')}
                        successFeedback="icon"
                        disabled={!apiKey}
                      />
                    </InputGroupButton>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Field>
              <SettingRowTitle>{t('apiGateway.authHeader.title')}</SettingRowTitle>
              <InputGroup className="mt-2 min-w-0">
                <InputGroupInput
                  className="font-mono text-xs"
                  aria-label={t('apiGateway.authHeader.title')}
                  value={`Authorization: Bearer ${apiKey ? (apiKeyVisible ? apiKey : '•'.repeat(Math.min(apiKey.length, 40))) : 'your-api-key'}`}
                  readOnly
                />
                <InputGroupAddon align="inline-end">
                  <Tooltip content={t('common.copy')}>
                    <InputGroupButton size="icon-xs" asChild>
                      <CopyButton
                        textToCopy={authorizationHeader}
                        size={16}
                        aria-label={t('common.copy')}
                        successFeedback="icon"
                      />
                    </InputGroupButton>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </CredentialFields>
        </SettingGroup>
      </Sections>
    </div>
  )
}

const StatusCard = ({
  $running,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $running: boolean }) => (
  <div
    className={cn(
      'flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4',
      $running
        ? 'border-success-border bg-success-subtle text-success-subtle-foreground'
        : 'border-border bg-card text-card-foreground',
      className
    )}
    {...props}
  />
)

const StatusSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-w-[min(100%,15rem)] flex-1 items-center gap-3', className)} {...props} />
)

const StatusIcon = ({
  $running,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $running: boolean }) => (
  <div
    className={cn(
      'flex size-11 shrink-0 items-center justify-center rounded-lg border bg-background',
      $running ? 'border-success-border text-success' : 'border-border text-muted-foreground',
      className
    )}
    {...props}
  />
)

const StatusContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-w-0 flex-col gap-1', className)} {...props} />
)

const StatusLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center gap-2', className)} {...props} />
)

const StatusText = ({
  $running,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $running: boolean }) => (
  <div
    className={cn('font-medium text-sm', $running ? 'text-success-subtle-foreground' : 'text-foreground', className)}
    {...props}
  />
)

const StatusSubtext = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('truncate text-muted-foreground text-xs', className)} {...props} />
)

// About 20rem fits Documentation, Restart, Stop, and their gaps.
const StatusActions = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      '@container/actions flex flex-1 basis-[min(100%,20rem)] flex-wrap items-center justify-end gap-2',
      className
    )}
    {...props}
  />
)

const Sections = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-4 flex flex-col gap-4', className)} {...props} />
)

const ConnectionFields = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('grid grid-cols-[minmax(0,1fr)_10rem] gap-4 p-4 max-sm:grid-cols-1', className)} {...props} />
)

const CredentialFields = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col gap-4 p-4', className)} {...props} />
)

const Field = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('min-w-0', className)} {...props} />
)

export default ApiGatewayPanel
