import { useTheme } from '@renderer/context/ThemeProvider'
import { loggerService } from '@renderer/services/LoggerService'
import { RootState, useAppDispatch } from '@renderer/store'
import { setApiServerApiKey, setApiServerEnabled, setApiServerPort } from '@renderer/store/settings'
import { IpcChannel } from '@shared/IpcChannel'
import { Button, Input, InputNumber, Tooltip, Typography } from 'antd'
import { Copy, ExternalLink, Play, RotateCcw, Square } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'
import { v4 as uuidv4 } from 'uuid'

import { SettingContainer } from '../..'

const logger = loggerService.withContext('ApiServerSettings')
const { Text, Title } = Typography

const ApiServerSettings: FC = () => {
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  // API Server state with proper defaults
  const apiServerConfig = useSelector((state: RootState) => state.settings.apiServer)

  const [apiServerRunning, setApiServerRunning] = useState(false)
  const [apiServerLoading, setApiServerLoading] = useState(false)

  // API Server functions
  const checkApiServerStatus = async () => {
    try {
      const status = await window.electron.ipcRenderer.invoke(IpcChannel.ApiServer_GetStatus)
      setApiServerRunning(status.running)
    } catch (error: any) {
      logger.error('Failed to check API server status:', error)
    }
  }

  useEffect(() => {
    checkApiServerStatus()
  }, [])

  const handleApiServerToggle = async (enabled: boolean) => {
    setApiServerLoading(true)
    try {
      if (enabled) {
        const result = await window.electron.ipcRenderer.invoke(IpcChannel.ApiServer_Start)
        if (result.success) {
          setApiServerRunning(true)
          window.message.success(t('apiServer.messages.startSuccess'))
        } else {
          window.message.error(t('apiServer.messages.startError') + result.error)
        }
      } else {
        const result = await window.electron.ipcRenderer.invoke(IpcChannel.ApiServer_Stop)
        if (result.success) {
          setApiServerRunning(false)
          window.message.success(t('apiServer.messages.stopSuccess'))
        } else {
          window.message.error(t('apiServer.messages.stopError') + result.error)
        }
      }
    } catch (error) {
      window.message.error(t('apiServer.messages.operationFailed') + (error as Error).message)
    } finally {
      dispatch(setApiServerEnabled(enabled))
      setApiServerLoading(false)
    }
  }

  const handleApiServerRestart = async () => {
    setApiServerLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.ApiServer_Restart)
      if (result.success) {
        await checkApiServerStatus()
        window.message.success(t('apiServer.messages.restartSuccess'))
      } else {
        window.message.error(t('apiServer.messages.restartError') + result.error)
      }
    } catch (error) {
      window.message.error(t('apiServer.messages.restartFailed') + (error as Error).message)
    } finally {
      setApiServerLoading(false)
    }
  }

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiServerConfig.apiKey)
    window.message.success(t('apiServer.messages.apiKeyCopied'))
  }

  const regenerateApiKey = () => {
    const newApiKey = `cs-sk-${uuidv4()}`
    dispatch(setApiServerApiKey(newApiKey))
    window.message.success(t('apiServer.messages.apiKeyRegenerated'))
  }

  const handlePortChange = (value: string) => {
    const port = parseInt(value) || 23333
    if (port >= 1000 && port <= 65535) {
      dispatch(setApiServerPort(port))
    }
  }

  const openApiDocs = () => {
    if (apiServerRunning) {
      window.open(`http://localhost:${apiServerConfig.port}/api-docs`, '_blank')
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
          <Button type="primary" icon={<ExternalLink size={14} />} onClick={openApiDocs}>
            {t('apiServer.documentation.title')}
          </Button>
        )}
      </HeaderSection>

      {/* Server Control Panel with integrated configuration */}
      <ServerControlPanel $status={apiServerRunning}>
        <StatusSection>
          <StatusIndicator $status={apiServerRunning} />
          <StatusContent>
            <StatusText $status={apiServerRunning}>
              {apiServerRunning ? t('apiServer.status.running') : t('apiServer.status.stopped')}
            </StatusText>
            <StatusSubtext>
              {apiServerRunning ? `http://localhost:${apiServerConfig.port}` : t('apiServer.fields.port.description')}
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
              onChange={(value) => handlePortChange(String(value || 23333))}
              min={1000}
              max={65535}
              disabled={apiServerRunning}
              placeholder="23333"
              size="middle"
            />
          )}

          <Tooltip title={apiServerRunning ? t('apiServer.actions.stop') : t('apiServer.actions.start')}>
            {apiServerRunning ? (
              <StopButton
                $loading={apiServerLoading}
                onClick={apiServerLoading ? undefined : () => handleApiServerToggle(false)}>
                <Square size={20} style={{ color: 'var(--color-status-error)' }} />
              </StopButton>
            ) : (
              <StartButton
                $loading={apiServerLoading}
                onClick={apiServerLoading ? undefined : () => handleApiServerToggle(true)}>
                <Play size={20} style={{ color: 'var(--color-status-success)' }} />
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
          value={apiServerConfig.apiKey}
          readOnly
          placeholder={t('apiServer.fields.apiKey.placeholder')}
          size="middle"
          suffix={
            <InputButtonContainer>
              {!apiServerRunning && (
                <RegenerateButton onClick={regenerateApiKey} disabled={apiServerRunning} type="link">
                  {t('apiServer.actions.regenerate')}
                </RegenerateButton>
              )}
              <Tooltip title={t('apiServer.fields.apiKey.copyTooltip')}>
                <InputButton icon={<Copy size={14} />} onClick={copyApiKey} disabled={!apiServerConfig.apiKey} />
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

// Styled Components
const Container = styled(SettingContainer)`
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
`

const HeaderSection = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
`

const HeaderContent = styled.div`
  flex: 1;
`

const ServerControlPanel = styled.div<{ $status: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-radius: 8px;
  background: var(--color-background);
  border: 1px solid ${(props) => (props.$status ? 'var(--color-status-success)' : 'var(--color-border)')};
  transition: all 0.3s ease;
  margin-bottom: 16px;
`

const StatusSection = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const StatusIndicator = styled.div<{ $status: boolean }>`
  position: relative;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${(props) => (props.$status ? 'var(--color-status-success)' : 'var(--color-status-error)')};

  &::before {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    background: ${(props) => (props.$status ? 'var(--color-status-success)' : 'var(--color-status-error)')};
    opacity: 0.2;
    animation: ${(props) => (props.$status ? 'pulse 2s infinite' : 'none')};
  }

  @keyframes pulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.2;
    }
    50% {
      transform: scale(1.5);
      opacity: 0.1;
    }
  }
`

const StatusContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const StatusText = styled.div<{ $status: boolean }>`
  font-weight: 600;
  font-size: 14px;
  color: ${(props) => (props.$status ? 'var(--color-status-success)' : 'var(--color-text-1)')};
  margin: 0;
`

const StatusSubtext = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  margin: 0;
`

const ControlSection = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const RestartButton = styled.div<{ $loading: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-2);
  cursor: ${(props) => (props.$loading ? 'not-allowed' : 'pointer')};
  opacity: ${(props) => (props.$loading ? 0.5 : 1)};
  font-size: 12px;
  transition: all 0.2s ease;

  &:hover {
    color: ${(props) => (props.$loading ? 'var(--color-text-2)' : 'var(--color-primary)')};
  }
`

const StyledInputNumber = styled(InputNumber)`
  width: 80px;
  border-radius: 6px;
  border: 1.5px solid var(--color-border);
  margin-right: 5px;
`

const StartButton = styled.div<{ $loading: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: ${(props) => (props.$loading ? 'not-allowed' : 'pointer')};
  opacity: ${(props) => (props.$loading ? 0.5 : 1)};
  transition: all 0.2s ease;

  &:hover {
    transform: ${(props) => (props.$loading ? 'scale(1)' : 'scale(1.1)')};
  }
`

const StopButton = styled.div<{ $loading: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: ${(props) => (props.$loading ? 'not-allowed' : 'pointer')};
  opacity: ${(props) => (props.$loading ? 0.5 : 1)};
  transition: all 0.2s ease;

  &:hover {
    transform: ${(props) => (props.$loading ? 'scale(1)' : 'scale(1.1)')};
  }
`

const ConfigurationField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: var(--color-background);
  border-radius: 8px;
  border: 1px solid var(--color-border);
`

const FieldLabel = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
  margin: 0;
`

const FieldDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  margin: 0;
`

const StyledInput = styled(Input)`
  width: 100%;
  border-radius: 6px;
  border: 1.5px solid var(--color-border);
`

const InputButtonContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const InputButton = styled(Button)`
  border: none;
  padding: 0 4px;
  background: transparent;
`

const RegenerateButton = styled(Button)`
  padding: 0 4px;
  font-size: 12px;
  height: auto;
  line-height: 1;
  border: none;
  background: transparent;
`

const AuthHeaderSection = styled.div`
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export default ApiServerSettings
