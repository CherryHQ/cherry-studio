import { CopyOutlined, GlobalOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { loggerService } from '@renderer/services/LoggerService'
import { RootState, useAppDispatch } from '@renderer/store'
import { setApiServerApiKey, setApiServerPort } from '@renderer/store/settings'
import { IpcChannel } from '@shared/IpcChannel'
import { Button, Card, Input, Space, Switch, Tooltip, Typography } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'
import { v4 as uuidv4 } from 'uuid'

import { SettingContainer } from '..'

const logger = loggerService.withContext('ApiServerSettings')
const { Text, Title } = Typography

const ConfigCard = styled(Card)`
  margin-bottom: 24px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  border: 1px solid var(--color-border);

  .ant-card-head {
    border-bottom: 1px solid var(--color-border);
    padding: 16px 24px;
  }

  .ant-card-body {
    padding: 16px 20px;
  }
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;

  h4 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-1);
  }
`

const FieldLabel = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
`

const ActionButtonGroup = styled(Space)`
  .ant-btn {
    border-radius: 6px;
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .ant-btn-primary {
    background: #1677ff;
    border-color: #1677ff;
  }

  .ant-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
`

const StyledInput = styled(Input)`
  border-radius: 6px;
  border: 1.5px solid var(--color-border);

  &:focus,
  &:focus-within {
    border-color: #1677ff;
    box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.1);
  }
`

const ServerControlPanel = styled.div<{ status: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 8px;
  background: ${(props) =>
    props.status
      ? 'linear-gradient(135deg, #f6ffed 0%, #f0f9ff 100%)'
      : 'linear-gradient(135deg, #fff2f0 0%, #fafafa 100%)'};
  border: 1px solid ${(props) => (props.status ? '#d9f7be' : '#ffd6d6')};
  transition: all 0.3s ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }
`

const StatusSection = styled.div<{ status: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;

  .status-indicator {
    position: relative;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: ${(props) => (props.status ? '#52c41a' : '#ff4d4f')};

    &::before {
      content: '';
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      background: ${(props) => (props.status ? '#52c41a' : '#ff4d4f')};
      opacity: 0.2;
      animation: ${(props) => (props.status ? 'pulse 2s infinite' : 'none')};
    }
  }

  .status-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .status-text {
    font-weight: 600;
    font-size: 14px;
    color: ${(props) => (props.status ? '#52c41a' : '#ff4d4f')};
    margin: 0;
  }

  .status-subtext {
    font-size: 12px;
    color: var(--color-text-3);
    margin: 0;
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

const ControlSection = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;


  .restart-btn {
    opacity: 0;
    transform: translateX(10px);
    transition: all 0.3s ease;

    &.visible {
      opacity: 1;
      transform: translateX(0);
    }
  }
`

const ApiServerSettings: FC = () => {
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  // API Server state with proper defaults
  const apiServerConfig = useSelector((state: RootState) => {
    return state.settings.apiServer
  })

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

  return (
    <SettingContainer theme={theme} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header Section */}
      <div style={{ marginBottom: 32 }}>
        <Title level={3} style={{ margin: 0, marginBottom: 8 }}>
          {t('apiServer.title')}
        </Title>
        <Text type="secondary">{t('apiServer.description')}</Text>
      </div>

      {/* Server Status & Configuration Card */}
      <ConfigCard
        title={
          <SectionHeader>
            <GlobalOutlined />
            <h4>{t('apiServer.configuration')}</h4>
          </SectionHeader>
        }>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {/* Server Control Panel */}
          <ServerControlPanel status={apiServerRunning}>
            <StatusSection status={apiServerRunning}>
              <div className="status-indicator" />
              <div className="status-content">
                <div className="status-text">
                  {apiServerRunning ? t('apiServer.status.running') : t('apiServer.status.stopped')}
                </div>
                <div className="status-subtext">
                  {apiServerRunning ? `http://localhost:${apiServerConfig.port}` : t('apiServer.fields.port.helpText')}
                </div>
              </div>
            </StatusSection>

            <ControlSection>
              <Switch
                checked={apiServerRunning}
                loading={apiServerLoading}
                onChange={handleApiServerToggle}
                size="default"
              />
              <Tooltip title={t('apiServer.actions.restart.tooltip')}>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={handleApiServerRestart}
                  loading={apiServerLoading}
                  size="small"
                  type="text"
                  className={`restart-btn ${apiServerRunning ? 'visible' : ''}`}>
                  {t('apiServer.actions.restart.button')}
                </Button>
              </Tooltip>
            </ControlSection>
          </ServerControlPanel>

          {/* Configuration Fields */}
          <div style={{ display: 'grid', gap: '12px' }}>
            {/* Port Configuration */}
            {!apiServerRunning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <FieldLabel style={{ minWidth: 50, margin: 0 }}>{t('apiServer.fields.port.label')}</FieldLabel>
                <StyledInput
                  type="number"
                  value={apiServerConfig.port}
                  onChange={(e) => handlePortChange(e.target.value)}
                  style={{ width: 100 }}
                  min={1000}
                  max={65535}
                  disabled={apiServerRunning}
                  placeholder="23333"
                  size="small"
                />
                {apiServerRunning && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('apiServer.fields.port.helpText')}
                  </Text>
                )}
              </div>
            )}

            {/* API Key Configuration */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <FieldLabel style={{ minWidth: 50, margin: 0 }}>{t('apiServer.fields.apiKey.label')}</FieldLabel>
              <StyledInput
                value={apiServerConfig.apiKey}
                readOnly
                style={{ flex: 1, minWidth: 200, maxWidth: 300 }}
                placeholder={t('apiServer.fields.apiKey.placeholder')}
                disabled={apiServerRunning}
                size="small"
              />
              <ActionButtonGroup>
                <Tooltip title={t('apiServer.fields.apiKey.copyTooltip')}>
                  <Button icon={<CopyOutlined />} onClick={copyApiKey} disabled={!apiServerConfig.apiKey} size="small">
                    {t('apiServer.actions.copy')}
                  </Button>
                </Tooltip>
                {!apiServerRunning && (
                  <Button onClick={regenerateApiKey} disabled={apiServerRunning} size="small">
                    {t('apiServer.actions.regenerate')}
                  </Button>
                )}
              </ActionButtonGroup>
            </div>

            {/* Authorization header info */}
            <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.3 }}>
              {t('apiServer.authHeaderText')}{' '}
              <Text code style={{ fontSize: 11 }}>
                Bearer {apiServerConfig.apiKey || 'your-api-key'}
              </Text>
            </Text>
          </div>
        </Space>
      </ConfigCard>

      {/* API Documentation Card */}
      <ConfigCard
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          marginBottom: 0
        }}
        styles={{
          body: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: 0
          }
        }}
        title={
          <SectionHeader>
            <h4>{t('apiServer.documentation.title')}</h4>
          </SectionHeader>
        }>
        {apiServerRunning ? (
          <iframe
            src={`http://localhost:${apiServerConfig.port}/api-docs`}
            style={{
              width: '100%',
              border: 'none',
              height: 'calc(100vh - 500px)'
            }}
            title="API Documentation"
            sandbox="allow-scripts allow-forms"
          />
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: 'var(--color-text-2)',
              background: 'var(--color-bg-2)',
              borderRadius: 8,
              border: '1px dashed var(--color-border)',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              margin: 16,
              height: '300px'
            }}>
            <GlobalOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
              {t('apiServer.documentation.unavailable.title')}
            </div>
            <div style={{ fontSize: 14 }}>{t('apiServer.documentation.unavailable.description')}</div>
          </div>
        )}
      </ConfigCard>
    </SettingContainer>
  )
}

export default ApiServerSettings
