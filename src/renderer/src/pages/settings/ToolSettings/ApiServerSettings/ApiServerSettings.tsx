import { Button, IndicatorLight, Tooltip } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { API_SERVER_DEFAULTS } from '@shared/config/constant'
import { Alert, Input, InputNumber, Typography } from 'antd'
import { Copy, ExternalLink, Play, RotateCcw, Square } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'

import { SettingContainer } from '../..'

const { Text, Title } = Typography

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
    if (apiServerConfig.apiKey) {
      void navigator.clipboard.writeText(apiServerConfig.apiKey)
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
    const port = parseInt(value) || API_SERVER_DEFAULTS.PORT
    if (port >= 1000 && port <= 65535) {
      void setApiServerConfig({ port })
    }
  }

  const openApiDocs = () => {
    if (apiServerRunning) {
      const host = apiServerConfig.host || API_SERVER_DEFAULTS.HOST
      const port = apiServerConfig.port || API_SERVER_DEFAULTS.PORT
      window.open(`http://${host}:${port}/api-docs`, '_blank')
    }
  }

  return (
    <Container theme={theme}>
      {/* Header Section */}
      <HeaderSection>
        <HeaderContent>
          <Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            {t('apiServer.title')}
          </Title>
          <Text type="secondary">{t('apiServer.description')}</Text>
        </HeaderContent>
        {apiServerRunning && (
          <Button onClick={openApiDocs}>
            <ExternalLink size={14} />
            {t('apiServer.documentation.title')}
          </Button>
        )}
      </HeaderSection>

      {!apiServerRunning && (
        <Alert type="warning" message={t('agent.warning.enable_server')} style={{ marginBottom: 10 }} showIcon />
      )}

      {/* Server Control Panel with integrated configuration */}
      <ServerControlPanel $status={apiServerRunning}>
        <StatusSection>
          <IndicatorLight
            color={apiServerRunning ? 'green' : '#ef4444'}
            size={10}
            animation={apiServerRunning}
            shadow={apiServerRunning}
          />
          <StatusContent>
            <StatusText $status={apiServerRunning}>
              {apiServerRunning ? t('apiServer.status.running') : t('apiServer.status.stopped')}
            </StatusText>
            <StatusSubtext>
              {apiServerRunning
                ? `http://${apiServerConfig.host || API_SERVER_DEFAULTS.HOST}:${apiServerConfig.port || API_SERVER_DEFAULTS.PORT}`
                : t('apiServer.fields.port.description')}
            </StatusSubtext>
          </StatusContent>
        </StatusSection>

        <ControlSection>
          {apiServerRunning && (
            <Tooltip title={t('apiServer.actions.restart.tooltip')}>
              <RestartButton
                $loading={apiServerLoading}
                onClick={apiServerLoading ? undefined : handleApiServerRestart}>
                <RotateCcw size={14} />
                <span>{t('apiServer.actions.restart.button')}</span>
              </RestartButton>
            </Tooltip>
          )}

          {/* Port input when server is stopped */}
          {!apiServerRunning && (
            <StyledInputNumber
              value={apiServerConfig.port}
              onChange={(value) => handlePortChange(String(value || API_SERVER_DEFAULTS.PORT))}
              min={1000}
              max={65535}
              disabled={apiServerRunning}
              placeholder={String(API_SERVER_DEFAULTS.PORT)}
              size="middle"
            />
          )}

          <Tooltip title={apiServerRunning ? t('apiServer.actions.stop') : t('apiServer.actions.start')}>
            {apiServerRunning ? (
              <StopButton
                $loading={apiServerLoading}
                onClick={apiServerLoading ? undefined : () => handleApiServerToggle(false)}>
                <Square size={20} style={{ color: 'var(--cs-error-base)' }} />
              </StopButton>
            ) : (
              <StartButton
                $loading={apiServerLoading}
                onClick={apiServerLoading ? undefined : () => handleApiServerToggle(true)}>
                <Play size={20} style={{ color: 'var(--cs-success-base)' }} />
              </StartButton>
            )}
          </Tooltip>
        </ControlSection>
      </ServerControlPanel>

      {/* API Key Configuration */}
      <ConfigurationField>
        <FieldLabel>{t('apiServer.fields.apiKey.label')}</FieldLabel>
        <FieldDescription>{t('apiServer.fields.apiKey.description')}</FieldDescription>

        <StyledInput
          value={apiServerConfig.apiKey || ''}
          readOnly
          placeholder={t('apiServer.fields.apiKey.placeholder')}
          size="middle"
          suffix={
            <InputButtonContainer>
              {!apiServerRunning && (
                <RegenerateButton onClick={regenerateApiKey} disabled={apiServerRunning} variant="link">
                  {t('apiServer.actions.regenerate')}
                </RegenerateButton>
              )}
              <Tooltip title={t('apiServer.fields.apiKey.copyTooltip')}>
                <InputButton onClick={copyApiKey} disabled={!apiServerConfig.apiKey}>
                  <Copy size={14} />
                </InputButton>
              </Tooltip>
            </InputButtonContainer>
          }
        />

        {/* Authorization header info */}
        <AuthHeaderSection>
          <FieldLabel>{t('apiServer.authHeader.title')}</FieldLabel>
          <StyledInput
            style={{ height: 38 }}
            value={`Authorization: Bearer ${apiServerConfig.apiKey || 'your-api-key'}`}
            readOnly
            size="middle"
          />
        </AuthHeaderSection>
      </ConfigurationField>
    </Container>
  )
}

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof SettingContainer>) => (
  <SettingContainer className={cn('flex h-[calc(100vh-var(--navbar-height))] flex-col', className)} {...props} />
)

const HeaderSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-6 flex flex-row items-center justify-between', className)} {...props} />
)

const HeaderContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex-1', className)} {...props} />
)

const ServerControlPanel = ({
  $status,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $status: boolean }) => (
  <div
    className={cn(
      'mb-4 flex items-center justify-between rounded-xs border px-5 py-4 transition-all duration-300',
      $status ? 'border-success-base' : 'border-border',
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

const StatusText = ({ $status, className, ...props }: React.ComponentPropsWithoutRef<'div'> & { $status: boolean }) => (
  <div
    className={cn('m-0 font-semibold text-sm', $status ? 'text-success-base' : 'text-foreground', className)}
    {...props}
  />
)

const StatusSubtext = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('m-0 text-foreground-muted text-xs', className)} {...props} />
)

const ControlSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center gap-3', className)} {...props} />
)

const RestartButton = ({
  $loading,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $loading: boolean }) => (
  <div
    className={cn(
      'flex items-center gap-1 text-foreground-secondary text-xs transition-all hover:text-primary',
      $loading ? 'cursor-not-allowed opacity-50 hover:text-foreground-secondary' : 'cursor-pointer opacity-100',
      className
    )}
    {...props}
  />
)

const StyledInputNumber = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof InputNumber>) => (
  <InputNumber className={cn('mr-[5px] w-20 rounded-md border-[1.5px] border-border', className)} {...props} />
)

const StartButton = ({
  $loading,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $loading: boolean }) => (
  <div
    className={cn(
      'inline-flex items-center justify-center transition-all hover:scale-110',
      $loading ? 'cursor-not-allowed opacity-50 hover:scale-100' : 'cursor-pointer opacity-100',
      className
    )}
    {...props}
  />
)

const StopButton = StartButton

const ConfigurationField = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col gap-2 rounded-xs border border-border bg-card p-4', className)} {...props} />
)

const FieldLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('m-0 font-medium text-foreground text-sm', className)} {...props} />
)

const FieldDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('m-0 text-foreground-muted text-xs', className)} {...props} />
)

const StyledInput = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Input>) => (
  <Input className={cn('w-full rounded-md border-[1.5px] border-border', className)} {...props} />
)

const InputButtonContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center gap-1', className)} {...props} />
)

const InputButton = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Button>) => (
  <Button className={cn('border-none bg-transparent px-1', className)} {...props} />
)

const RegenerateButton = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Button>) => (
  <Button className={cn('h-auto border-none bg-transparent px-1 text-xs leading-none', className)} {...props} />
)

const AuthHeaderSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-3 flex flex-col gap-2', className)} {...props} />
)

export default ApiServerSettings
