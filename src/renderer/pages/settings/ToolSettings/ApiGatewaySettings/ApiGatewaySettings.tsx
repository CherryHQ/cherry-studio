import { Button, ButtonGroup, IndicatorLight, Input, Tooltip } from '@cherrystudio/ui'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { useTheme } from '@renderer/hooks/useTheme'
import { cn } from '@renderer/utils/style'
import { Copy, ExternalLink, Play, RotateCcw, Server, Square, TriangleAlert } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'

import {
  SettingCard,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingsPageHeader
} from '../..'

const API_SERVER_DEFAULTS = {
  HOST: '127.0.0.1',
  PORT: 23333
}

const ApiGatewaySettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()

  // API Gateway state from useApiGateway hook
  const {
    apiGatewayConfig,
    apiGatewayRunning,
    apiGatewayLoading,
    startApiGateway,
    stopApiGateway,
    restartApiGateway,
    setApiGatewayConfig
  } = useApiGateway()

  const serverHost = apiGatewayConfig.host || API_SERVER_DEFAULTS.HOST
  const serverPort = apiGatewayConfig.port || API_SERVER_DEFAULTS.PORT
  const serverUrl = `http://${serverHost}:${serverPort}`
  const apiKey = apiGatewayConfig.apiKey || ''

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

  const copyApiKey = async () => {
    if (!apiKey) return
    try {
      await navigator.clipboard.writeText(apiKey)
      window.toast.success(t('apiGateway.messages.apiKeyCopied'))
    } catch {
      // Clipboard write can be denied (permissions / insecure context); don't
      // report a copy that didn't happen.
      window.toast.error(t('apiGateway.messages.operationFailed'))
    }
  }

  const generateApiKey = () => {
    return `cs-sk-${uuidv4()}`
  }

  const regenerateApiKey = () => {
    void setApiGatewayConfig({ apiKey: generateApiKey() })
    window.toast.success(t('apiGateway.messages.apiKeyRegenerated'))
  }

  const handlePortChange = (value: string) => {
    const port = Number.parseInt(value, 10) || API_SERVER_DEFAULTS.PORT
    if (port >= 1000 && port <= 65535) {
      void setApiGatewayConfig({ port })
    }
  }

  const openApiDocs = () => {
    if (apiGatewayRunning) {
      // The ElysiaJS `@elysia/openapi` plugin serves the docs UI at `/openapi`
      // (the Express `/api-docs` path was removed in the gateway migration).
      window.open(`${serverUrl}/openapi`, '_blank')
    }
  }

  return (
    <Container theme={theme}>
      <SettingGroup theme={theme}>
        <SettingsPageHeader
          icon={<Server />}
          title={t('apiGateway.title')}
          description={t('apiGateway.description')}
          action={
            apiGatewayRunning && (
              <Button
                variant="outline"
                className="rounded-lg [&_svg]:[stroke-width:var(--icon-stroke)]"
                onClick={openApiDocs}>
                <ExternalLink size={14} />
                {t('apiGateway.documentation.title')}
              </Button>
            )
          }
        />

        <div className="mt-3 space-y-3">
          {!apiGatewayRunning && (
            <WarningBanner>
              <TriangleAlert className="size-4 shrink-0 text-warning" />
              <span>{t('agent.warning.enable_server')}</span>
            </WarningBanner>
          )}
          <StatusCard $running={apiGatewayRunning}>
            <StatusSection>
              <IndicatorLight
                color={apiGatewayRunning ? 'var(--color-success-base)' : 'var(--color-error-base)'}
                size={10}
                animation={apiGatewayRunning}
                shadow={apiGatewayRunning}
              />
              <StatusContent>
                <StatusText $running={apiGatewayRunning}>
                  {apiGatewayRunning ? t('apiGateway.status.running') : t('apiGateway.status.stopped')}
                </StatusText>
                <StatusSubtext>{apiGatewayRunning ? serverUrl : t('apiGateway.fields.port.description')}</StatusSubtext>
              </StatusContent>
            </StatusSection>

            <ButtonGroup attached={false}>
              {apiGatewayRunning && (
                <Tooltip title={t('apiGateway.actions.restart.tooltip')}>
                  <Button
                    variant="outline"
                    className="rounded-lg [&_svg]:[stroke-width:var(--icon-stroke)]"
                    loading={apiGatewayLoading}
                    onClick={handleApiGatewayRestart}>
                    <RotateCcw size={14} />
                    {t('apiGateway.actions.restart.button')}
                  </Button>
                </Tooltip>
              )}
              {apiGatewayRunning ? (
                <Button
                  variant="outline"
                  className="rounded-lg [&_svg]:[stroke-width:var(--icon-stroke)]"
                  loading={apiGatewayLoading}
                  onClick={() => handleApiGatewayToggle(false)}>
                  <Square size={14} />
                  {t('apiGateway.actions.stop')}
                </Button>
              ) : (
                <Button size="sm" loading={apiGatewayLoading} onClick={() => handleApiGatewayToggle(true)}>
                  <Play size={14} />
                  {t('apiGateway.actions.start')}
                </Button>
              )}
            </ButtonGroup>
          </StatusCard>
          <SettingCard className="mt-0">
            {!apiGatewayRunning && (
              <>
                <SettingRow>
                  <SettingRowTitle tip={t('apiGateway.fields.port.description')}>
                    {t('apiGateway.fields.port.label')}
                  </SettingRowTitle>
                  <Input
                    className="w-24 text-center"
                    type="number"
                    min={1000}
                    max={65535}
                    value={serverPort}
                    onChange={(event) => handlePortChange(event.target.value)}
                  />
                </SettingRow>
                <SettingRow>
                  <SettingRowTitle className="flex-none" tip={t('apiGateway.messages.notEnabled')}>
                    {t('apiGateway.fields.url.label')}
                  </SettingRowTitle>
                  <Input
                    className="min-w-0 max-w-105 flex-1 font-mono text-xs"
                    value={serverUrl}
                    readOnly
                    disabled
                  />
                </SettingRow>
              </>
            )}
            <SettingRow>
              <SettingRowTitle className="flex-none" tip={t('apiGateway.fields.apiKey.description')}>
                {t('apiGateway.fields.apiKey.label')}
              </SettingRowTitle>
              <InlineInputGroup>
                <Input
                  className="min-w-0 flex-1 font-mono text-xs"
                  value={apiKey}
                  readOnly
                  placeholder={t('apiGateway.fields.apiKey.placeholder')}
                />
                <ButtonGroup attached={false}>
                  {!apiGatewayRunning && (
                    <Button
                      variant="outline"
                      className="h-8 rounded-lg hover:bg-(--color-surface-fg-subtle-solid) [&_svg]:[stroke-width:var(--icon-stroke)]"
                      onClick={regenerateApiKey}>
                      {t('apiGateway.actions.regenerate')}
                    </Button>
                  )}
                  <Tooltip title={t('apiGateway.fields.apiKey.copyTooltip')}>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      className="size-8 rounded-lg hover:bg-(--color-surface-fg-subtle-solid) [&_svg]:[stroke-width:var(--icon-stroke)]"
                      onClick={copyApiKey}
                      disabled={!apiKey}>
                      <Copy size={14} />
                    </Button>
                  </Tooltip>
                </ButtonGroup>
              </InlineInputGroup>
            </SettingRow>
            <SettingRow>
              <SettingRowTitle className="flex-none" tip={t('apiGateway.authHeaderText')}>
                {t('apiGateway.authHeader.title')}
              </SettingRowTitle>
              <Input
                className="min-w-0 max-w-105 flex-1 font-mono text-xs"
                value={`Authorization: Bearer ${apiKey || 'your-api-key'}`}
                readOnly
              />
            </SettingRow>
          </SettingCard>
        </div>
      </SettingGroup>
    </Container>
  )
}

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof SettingsContentColumn>) => (
  <SettingsContentColumn className={cn('flex h-[calc(100vh-var(--navbar-height))] flex-col', className)} {...props} />
)

const WarningBanner = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'mb-2 flex items-center gap-2 rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning',
      className
    )}
    {...props}
  />
)

const StatusCard = ({
  $running,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $running: boolean }) => (
  <div
    className={cn(
      'flex items-center justify-between gap-4 rounded-lg border p-3',
      $running ? 'border-success/20 bg-success/5' : 'border-border bg-card',
      className
    )}
    {...props}
  />
)

const StatusSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center gap-2.5', className)} {...props} />
)

const StatusContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col gap-0.5', className)} {...props} />
)

const StatusText = ({
  $running,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $running: boolean }) => (
  <div
    className={cn('m-0 font-semibold text-sm', $running ? 'text-success' : 'text-foreground', className)}
    {...props}
  />
)

const StatusSubtext = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('m-0 text-foreground-muted text-xs', className)} {...props} />
)

const InlineInputGroup = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-w-0 max-w-105 flex-1 items-center gap-2', className)} {...props} />
)

export default ApiGatewaySettings
