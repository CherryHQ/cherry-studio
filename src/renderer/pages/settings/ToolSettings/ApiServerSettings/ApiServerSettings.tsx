import { Button, ButtonGroup, IndicatorLight, Input, Tooltip } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { API_SERVER_DEFAULTS } from '@shared/config/constant'
import { Copy, ExternalLink, Play, RotateCcw, Server, Square, TriangleAlert } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '../..'

const ApiServerSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()

  // API Server state from useApiServer hook
  const {
    apiServerConfig,
    apiServerRunning,
    apiServerLoading,
    startApiServer,
    stopApiServer,
    restartApiServer,
    setApiServerEnabled,
    setApiServerConfig
  } = useApiServer()

  const serverHost = apiServerConfig.host || API_SERVER_DEFAULTS.HOST
  const serverPort = apiServerConfig.port || API_SERVER_DEFAULTS.PORT
  const serverUrl = `http://${serverHost}:${serverPort}`
  const apiKey = apiServerConfig.apiKey || ''

  const handleApiServerToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        await startApiServer()
      } else {
        await stopApiServer()
      }
    } catch (error) {
      window.toast.error(t('apiServer.messages.operationFailed') + formatErrorMessage(error))
    } finally {
      setApiServerEnabled(enabled)
    }
  }

  const handleApiServerRestart = async () => {
    await restartApiServer()
  }

  const copyApiKey = () => {
    if (apiKey) {
      void navigator.clipboard.writeText(apiKey)
    }
    window.toast.success(t('apiServer.messages.apiKeyCopied'))
  }

  const generateApiKey = () => {
    return `cs-sk-${uuidv4()}`
  }

  const regenerateApiKey = () => {
    void setApiServerConfig({ apiKey: generateApiKey() })
    window.toast.success(t('apiServer.messages.apiKeyRegenerated'))
  }

  const handlePortChange = (value: string) => {
    const port = Number.parseInt(value, 10) || API_SERVER_DEFAULTS.PORT
    if (port >= 1000 && port <= 65535) {
      void setApiServerConfig({ port })
    }
  }

  const openApiDocs = () => {
    if (apiServerRunning) {
      window.open(`${serverUrl}/api-docs`, '_blank')
    }
  }

  return (
    <Container theme={theme}>
      <SettingGroup theme={theme}>
        <HeaderRow>
          <div className="min-w-0">
            <SettingTitle className="justify-start gap-2">
              <Server size={16} />
              {t('apiServer.title')}
            </SettingTitle>
            <PageDescription>{t('apiServer.description')}</PageDescription>
          </div>
          {apiServerRunning && (
            <Button variant="outline" onClick={openApiDocs}>
              <ExternalLink size={14} />
              {t('apiServer.documentation.title')}
            </Button>
          )}
        </HeaderRow>

        <SettingDivider />
        {!apiServerRunning && (
          <WarningBanner>
            <TriangleAlert className="size-4 shrink-0 text-warning" />
            <span>{t('agent.warning.enable_server')}</span>
          </WarningBanner>
        )}
        <StatusCard $running={apiServerRunning}>
          <StatusSection>
            <IndicatorLight
              color={apiServerRunning ? 'green' : '#ef4444'}
              size={10}
              animation={apiServerRunning}
              shadow={apiServerRunning}
            />
            <StatusContent>
              <StatusText $running={apiServerRunning}>
                {apiServerRunning ? t('apiServer.status.running') : t('apiServer.status.stopped')}
              </StatusText>
              <StatusSubtext>{apiServerRunning ? serverUrl : t('apiServer.fields.port.description')}</StatusSubtext>
            </StatusContent>
          </StatusSection>

          <ButtonGroup attached={false}>
            {apiServerRunning && (
              <Tooltip title={t('apiServer.actions.restart.tooltip')}>
                <Button variant="outline" loading={apiServerLoading} onClick={handleApiServerRestart}>
                  <RotateCcw size={14} />
                  {t('apiServer.actions.restart.button')}
                </Button>
              </Tooltip>
            )}
            {apiServerRunning ? (
              <Button variant="outline" loading={apiServerLoading} onClick={() => handleApiServerToggle(false)}>
                <Square size={14} />
                {t('apiServer.actions.stop')}
              </Button>
            ) : (
              <Button loading={apiServerLoading} onClick={() => handleApiServerToggle(true)}>
                <Play size={14} />
                {t('apiServer.actions.start')}
              </Button>
            )}
          </ButtonGroup>
        </StatusCard>
        {!apiServerRunning && (
          <>
            <SettingDivider />
            <SettingRow className="items-start gap-6">
              <FieldText>
                <SettingRowTitle>{t('apiServer.fields.port.label')}</SettingRowTitle>
                <FieldDescription>{t('apiServer.fields.port.description')}</FieldDescription>
              </FieldText>
              <Input
                className="w-24 text-center"
                type="number"
                min={1000}
                max={65535}
                value={serverPort}
                onChange={(event) => handlePortChange(event.target.value)}
              />
            </SettingRow>
            <SettingDivider />
            <SettingRow className="items-start gap-6">
              <FieldText>
                <SettingRowTitle>{t('apiServer.fields.url.label')}</SettingRowTitle>
                <FieldDescription>{t('apiServer.messages.notEnabled')}</FieldDescription>
              </FieldText>
              <Input className="w-[420px] font-mono text-xs" value={serverUrl} readOnly disabled />
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow className="items-start gap-6">
          <FieldText>
            <SettingRowTitle>{t('apiServer.fields.apiKey.label')}</SettingRowTitle>
            <FieldDescription>{t('apiServer.fields.apiKey.description')}</FieldDescription>
          </FieldText>
          <InlineInputGroup>
            <Input
              className="font-mono text-xs"
              value={apiKey}
              readOnly
              placeholder={t('apiServer.fields.apiKey.placeholder')}
            />
            <ButtonGroup attached={false}>
              {!apiServerRunning && (
                <Button variant="outline" onClick={regenerateApiKey}>
                  {t('apiServer.actions.regenerate')}
                </Button>
              )}
              <Tooltip title={t('apiServer.fields.apiKey.copyTooltip')}>
                <Button size="icon-sm" variant="outline" onClick={copyApiKey} disabled={!apiKey}>
                  <Copy size={14} />
                </Button>
              </Tooltip>
            </ButtonGroup>
          </InlineInputGroup>
        </SettingRow>
        <SettingDivider />
        <SettingRow className="items-start gap-6">
          <FieldText>
            <SettingRowTitle>{t('apiServer.authHeader.title')}</SettingRowTitle>
            <FieldDescription>{t('apiServer.authHeaderText')}</FieldDescription>
          </FieldText>
          <Input
            className="w-[420px] font-mono text-xs"
            value={`Authorization: Bearer ${apiKey || 'your-api-key'}`}
            readOnly
          />
        </SettingRow>
      </SettingGroup>
    </Container>
  )
}

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof SettingContainer>) => (
  <SettingContainer className={cn('flex h-[calc(100vh-var(--navbar-height))] flex-col', className)} {...props} />
)

const HeaderRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center justify-between gap-4', className)} {...props} />
)

const PageDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2 max-w-[560px] text-foreground-muted text-xs leading-5', className)} {...props} />
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

const FieldDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-1 text-foreground-muted text-xs leading-5', className)} {...props} />
)

const FieldText = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('min-w-0 flex-1', className)} {...props} />
)

const InlineInputGroup = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex w-[420px] items-center gap-2', className)} {...props} />
)

export default ApiServerSettings
