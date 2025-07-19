import { CopyOutlined, GlobalOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { loggerService } from '@renderer/services/LoggerService'
import { RootState, useAppDispatch } from '@renderer/store'
import { setApiServerApiKey, setApiServerPort } from '@renderer/store/settings'
import { IpcChannel } from '@shared/IpcChannel'
import { Button, Card, Divider, Flex, Input, Space, Switch, Tooltip, Typography } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

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
    padding: 24px;
  }
`

const ConfigSection = styled.div`
  margin-bottom: 32px;

  &:last-child {
    margin-bottom: 0;
  }
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;

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

const FieldGroup = styled.div`
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
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

const StatusIndicator = styled.div<{ status: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: ${(props) => (props.status ? '#f6ffed' : '#fff2f0')};
  border: 1px solid ${(props) => (props.status ? '#b7eb8f' : '#ffb3b3')};

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${(props) => (props.status ? '#52c41a' : '#ff4d4f')};
  }

  .status-text {
    font-weight: 500;
    color: ${(props) => (props.status ? '#52c41a' : '#ff4d4f')};
  }
`

const ApiServerSettings: FC = () => {
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  // API Server state with proper defaults
  const apiServerSettings = useSelector((state: RootState) => {
    const settings = state.settings.apiServer
    return {
      port: settings?.port ?? 13333,
      apiKey: settings?.apiKey ?? ''
    }
  })

  const [apiServerRunning, setApiServerRunning] = useState(false)
  const [apiServerLoading, setApiServerLoading] = useState(false)

  // API Server functions
  const checkApiServerStatus = async () => {
    try {
      const status = await window.electron.ipcRenderer.invoke(IpcChannel.ApiServer_GetStatus)
      setApiServerRunning(status.running)
    } catch (error) {
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
          window.message.success('API Server started successfully')
        } else {
          window.message.error('Failed to start API Server: ' + result.error)
        }
      } else {
        const result = await window.electron.ipcRenderer.invoke(IpcChannel.ApiServer_Stop)
        if (result.success) {
          setApiServerRunning(false)
          window.message.success('API Server stopped successfully')
        } else {
          window.message.error('Failed to stop API Server: ' + result.error)
        }
      }
    } catch (error) {
      window.message.error('API Server operation failed: ' + (error as Error).message)
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
        window.message.success('API Server restarted successfully')
      } else {
        window.message.error('Failed to restart API Server: ' + result.error)
      }
    } catch (error) {
      window.message.error('API Server restart failed: ' + (error as Error).message)
    } finally {
      setApiServerLoading(false)
    }
  }

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiServerSettings.apiKey)
    window.message.success('API Key copied to clipboard')
  }

  const regenerateApiKey = () => {
    const newApiKey = `cs-${Date.now()}-${Math.random().toString(36).substring(2)}`
    dispatch(setApiServerApiKey(newApiKey))
    window.message.success('API Key regenerated')
  }

  const copyServerUrl = () => {
    const url = `http://localhost:${apiServerSettings.port}`
    navigator.clipboard.writeText(url)
    window.message.success('Server URL copied to clipboard')
  }

  const handlePortChange = (value: string) => {
    const port = parseInt(value) || 13333
    if (port >= 1000 && port <= 65535) {
      dispatch(setApiServerPort(port))
    }
  }

  return (
    <SettingContainer theme={theme}>
      {/* Header Section */}
      <div style={{ marginBottom: 32 }}>
        <Title level={3} style={{ margin: 0, marginBottom: 8 }}>
          API Server
        </Title>
        <Text type="secondary">Expose Cherry Studio's AI capabilities through OpenAI-compatible HTTP APIs</Text>
      </div>

      {/* Server Status Card */}
      <ConfigCard
        title={
          <SectionHeader>
            <GlobalOutlined />
            <h4>Server Status</h4>
          </SectionHeader>
        }>
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <StatusIndicator status={apiServerRunning}>
              <div className="status-dot" />
              <span className="status-text">{apiServerRunning ? 'Running' : 'Stopped'}</span>
            </StatusIndicator>
            <ActionButtonGroup>
              <Switch
                checked={apiServerRunning}
                loading={apiServerLoading}
                onChange={handleApiServerToggle}
                size="default"
              />
              {apiServerRunning && (
                <Tooltip title="Restart Server">
                  <Button icon={<ReloadOutlined />} onClick={handleApiServerRestart} loading={apiServerLoading}>
                    Restart
                  </Button>
                </Tooltip>
              )}
            </ActionButtonGroup>
          </div>

          {apiServerRunning && (
            <FieldGroup>
              <FieldLabel>Server URL</FieldLabel>
              <Flex gap={8} align="center">
                <StyledInput
                  value={`http://localhost:${apiServerSettings.port}`}
                  readOnly
                  style={{ flex: 1, maxWidth: 300 }}
                />
                <Tooltip title="Copy URL">
                  <Button icon={<CopyOutlined />} onClick={copyServerUrl}>
                    Copy
                  </Button>
                </Tooltip>
              </Flex>
            </FieldGroup>
          )}
        </Space>
      </ConfigCard>

      {/* Configuration Card */}
      <ConfigCard
        title={
          <SectionHeader>
            <h4>Configuration</h4>
          </SectionHeader>
        }>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          {/* Port Configuration */}
          <FieldGroup>
            <FieldLabel>Port</FieldLabel>
            <StyledInput
              type="number"
              value={apiServerSettings.port}
              onChange={(e) => handlePortChange(e.target.value)}
              style={{ width: 120 }}
              min={1000}
              max={65535}
              disabled={apiServerRunning}
              placeholder="13333"
            />
            {apiServerRunning && (
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                Stop the server to change the port
              </Text>
            )}
          </FieldGroup>

          {/* API Key Configuration */}
          <FieldGroup>
            <FieldLabel>API Key</FieldLabel>
            <Flex gap={8} align="center" wrap="wrap">
              <StyledInput
                value={apiServerSettings.apiKey}
                readOnly
                style={{ flex: 1, minWidth: 300, maxWidth: 500 }}
                placeholder="API key will be auto-generated"
                disabled={apiServerRunning}
              />
              <ActionButtonGroup>
                <Tooltip title="Copy API Key">
                  <Button icon={<CopyOutlined />} onClick={copyApiKey} disabled={!apiServerSettings.apiKey}>
                    Copy
                  </Button>
                </Tooltip>
                <Button onClick={regenerateApiKey} disabled={apiServerRunning}>
                  Regenerate
                </Button>
              </ActionButtonGroup>
            </Flex>
            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4, marginTop: 8, display: 'block' }}>
              Use this API key in the Authorization header:{' '}
              <Text code>Authorization: Bearer {apiServerSettings.apiKey || 'your-api-key'}</Text>
            </Text>
          </FieldGroup>
        </Space>
      </ConfigCard>

      {/* API Documentation Card */}
      <ConfigCard
        title={
          <SectionHeader>
            <h4>Available Endpoints</h4>
          </SectionHeader>
        }>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <ConfigSection>
            <Text strong style={{ fontSize: 14 }}>
              Health Check
            </Text>
            <div style={{ marginTop: 8 }}>
              <Text code style={{ background: '#f6f8fa', padding: '2px 6px', borderRadius: 4 }}>
                GET /health
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                Check server status (no authentication required)
              </Text>
            </div>
          </ConfigSection>

          <Divider style={{ margin: 0 }} />

          <ConfigSection>
            <Text strong style={{ fontSize: 14 }}>
              OpenAI Compatible APIs
            </Text>
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 6 }}>
                <Text code style={{ background: '#f6f8fa', padding: '2px 6px', borderRadius: 4 }}>
                  POST /api/chat/completions
                </Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  Chat completions
                </Text>
              </div>
              <div style={{ marginBottom: 6 }}>
                <Text code style={{ background: '#f6f8fa', padding: '2px 6px', borderRadius: 4 }}>
                  GET /api/models
                </Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  List available models
                </Text>
              </div>
              <div style={{ marginBottom: 6 }}>
                <Text code style={{ background: '#f6f8fa', padding: '2px 6px', borderRadius: 4 }}>
                  POST /api/embeddings
                </Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  Generate embeddings
                </Text>
              </div>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                Compatible with OpenAI SDK and tools
              </Text>
            </div>
          </ConfigSection>

          <Divider style={{ margin: 0 }} />

          <ConfigSection>
            <Text strong style={{ fontSize: 14 }}>
              Cherry Studio Specific
            </Text>
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 6 }}>
                <Text code style={{ background: '#f6f8fa', padding: '2px 6px', borderRadius: 4 }}>
                  GET /api/mcps
                </Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  List MCP servers
                </Text>
              </div>
              <div style={{ marginBottom: 6 }}>
                <Text code style={{ background: '#f6f8fa', padding: '2px 6px', borderRadius: 4 }}>
                  POST /api/notifications
                </Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  Send notifications
                </Text>
              </div>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                Access Cherry Studio's unique features
              </Text>
            </div>
          </ConfigSection>
        </Space>
      </ConfigCard>
    </SettingContainer>
  )
}

export default ApiServerSettings
