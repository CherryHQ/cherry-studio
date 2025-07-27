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
    padding: 24px;
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

  const copyServerUrl = () => {
    const url = `http://localhost:${apiServerConfig.port}`
    navigator.clipboard.writeText(url)
    window.message.success(t('apiServer.messages.urlCopied'))
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
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* Status and Control Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16
            }}>
            <StatusIndicator status={apiServerRunning}>
              <div className="status-dot" />
              <span className="status-text">
                {apiServerRunning ? t('apiServer.status.running') : t('apiServer.status.stopped')}
              </span>
            </StatusIndicator>
            <ActionButtonGroup>
              <Switch
                checked={apiServerRunning}
                loading={apiServerLoading}
                onChange={handleApiServerToggle}
                size="default"
              />
              {apiServerRunning && (
                <Tooltip title={t('apiServer.actions.restart.tooltip')}>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={handleApiServerRestart}
                    loading={apiServerLoading}
                    size="small">
                    {t('apiServer.actions.restart.button')}
                  </Button>
                </Tooltip>
              )}
            </ActionButtonGroup>
          </div>

          {/* Configuration Fields */}
          <div style={{ display: 'grid', gap: '16px' }}>
            {/* Port Configuration */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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

            {/* Server URL (only when running) */}
            {apiServerRunning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <FieldLabel style={{ minWidth: 50, margin: 0 }}>{t('apiServer.fields.url.label')}</FieldLabel>
                <StyledInput
                  value={`http://localhost:${apiServerConfig.port}`}
                  readOnly
                  style={{ flex: 1, maxWidth: 250 }}
                  size="small"
                />
                <Tooltip title={t('apiServer.fields.url.copyTooltip')}>
                  <Button icon={<CopyOutlined />} onClick={copyServerUrl} size="small">
                    {t('apiServer.actions.copy')}
                  </Button>
                </Tooltip>
              </div>
            )}

            {/* API Key Configuration */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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
                <Button onClick={regenerateApiKey} disabled={apiServerRunning} size="small">
                  {t('apiServer.actions.regenerate')}
                </Button>
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
        bodyStyle={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: 0
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
              flex: 1,
              border: 'none',
              minHeight: 500
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
              minHeight: 300
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
