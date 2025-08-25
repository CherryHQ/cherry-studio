import { ArrowLeftOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPServer } from '@renderer/types'
import { getTextColorOnPrimary } from '@renderer/utils'
import { Button, Card } from 'antd'
import { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { Link, useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import { SettingContainer } from '..'
import InstallNpxUv from './InstallNpxUv'
import McpServersList from './McpServersList'
import McpSettings from './McpSettings'
import NpxSearch from './NpxSearch'

const MCPSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { addMCPServer, mcpServers } = useMCPServers()

  const location = useLocation()
  const pathname = location.pathname

  const isHome = pathname === '/settings/mcp'

  // Handle MCP add from URL params
  useEffect(() => {
    const handleAddMCP = (data: {
      id: string
      name: string
      command?: string
      baseUrl?: string
      type?: MCPServer['type']
      description?: string
    }) => {
      const { id, name, command, baseUrl, type, description } = data

      // Check if MCP server with this ID already exists
      const existingServer = mcpServers.find((s) => s.id === id)

      const serverToProcess: MCPServer = existingServer || {
        id,
        name: name,
        type: type || (baseUrl ? 'sse' : 'stdio'),
        description: description || '',
        baseUrl: baseUrl || '',
        command: command || '',
        args: [],
        env: {},
        isActive: false
      }

      const confirmMessage = existingServer
        ? t('settings.mcp.server_already_exists', {
            server: serverToProcess.name
          })
        : t('settings.mcp.server_add_confirm', {
            server: serverToProcess.name
          })

      window.modal.confirm({
        title: t('settings.mcp.server_confirm_title', { server: serverToProcess.name }),
        content: (
          <MCPInfoContainer>
            <MCPInfoCard size="small">
              <MCPInfoRow>
                <MCPInfoLabel>{t('settings.mcp.name')}:</MCPInfoLabel>
                <MCPInfoValue>{serverToProcess.name}</MCPInfoValue>
              </MCPInfoRow>
              <MCPInfoRow>
                <MCPInfoLabel>{t('settings.mcp.type')}:</MCPInfoLabel>
                <MCPInfoValue>{serverToProcess.type}</MCPInfoValue>
              </MCPInfoRow>
              {serverToProcess.description && (
                <MCPInfoRow>
                  <MCPInfoLabel>{t('settings.mcp.description')}:</MCPInfoLabel>
                  <MCPInfoValue>{serverToProcess.description}</MCPInfoValue>
                </MCPInfoRow>
              )}
              {serverToProcess.baseUrl && (
                <MCPInfoRow>
                  <MCPInfoLabel>{t('settings.mcp.url')}:</MCPInfoLabel>
                  <MCPInfoValue>{serverToProcess.baseUrl}</MCPInfoValue>
                </MCPInfoRow>
              )}
              {serverToProcess.command && (
                <MCPInfoRow>
                  <MCPInfoLabel>{t('settings.mcp.command')}:</MCPInfoLabel>
                  <CommandHighlight>{serverToProcess.command}</CommandHighlight>
                </MCPInfoRow>
              )}
            </MCPInfoCard>
            <ConfirmMessage>{confirmMessage}</ConfirmMessage>
          </MCPInfoContainer>
        ),
        okText: existingServer ? t('common.confirm') : t('common.add'),
        cancelText: t('common.cancel'),
        centered: true,
        onCancel() {
          navigate('/settings/mcp')
        },
        onOk() {
          if (existingServer) {
            window.message.info(t('settings.mcp.server_no_change', { server: serverToProcess.name }))
            navigate(`/settings/mcp/settings/${encodeURIComponent(existingServer.id)}`)
            return
          }

          addMCPServer(serverToProcess)
          navigate(`/settings/mcp/settings/${encodeURIComponent(serverToProcess.id)}`)
          window.message.success(t('settings.mcp.server_added', { server: serverToProcess.name }))
        }
      })
    }

    // Check URL parameters
    const addMcpData = searchParams.get('addMcpData')
    if (!addMcpData) {
      return
    }

    try {
      const { id, name, command, baseUrl, type, description } = JSON.parse(addMcpData)
      if (!id || !name) {
        window.message.error(t('settings.mcp.add_failed_invalid_data'))
        navigate('/settings/mcp')
        return
      }

      handleAddMCP({ id, name, command, baseUrl, type, description })
    } catch (error) {
      window.message.error(t('settings.mcp.add_failed_invalid_data'))
      navigate('/settings/mcp')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return (
    <SettingContainer theme={theme} style={{ padding: 0, position: 'relative' }}>
      {!isHome && (
        <BackButtonContainer>
          <Link to="/settings/mcp">
            <Button type="default" icon={<ArrowLeftOutlined />} shape="circle" />
          </Link>
        </BackButtonContainer>
      )}
      <MainContainer>
        <Routes>
          <Route path="/" element={<McpServersList />} />
          <Route path="settings/:serverId" element={<McpSettings />} />
          <Route
            path="npx-search"
            element={
              <SettingContainer theme={theme}>
                <NpxSearch />
              </SettingContainer>
            }
          />
          <Route
            path="mcp-install"
            element={
              <SettingContainer theme={theme}>
                <InstallNpxUv />
              </SettingContainer>
            }
          />
        </Routes>
      </MainContainer>
    </SettingContainer>
  )
}

const BackButtonContainer = styled.div`
  display: flex;
  align-items: center;
  padding: 10px 20px;
  background-color: transparent;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
`

const MCPInfoContainer = styled.div`
  color: var(--color-text);
`

const MCPInfoCard = styled(Card)`
  margin-bottom: 16px;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);

  .ant-card-body {
    padding: 12px;
  }
`

const MCPInfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;

  &:last-child {
    margin-bottom: 0;
  }
`

const MCPInfoLabel = styled.span`
  font-weight: 600;
  color: var(--color-text-2);
  min-width: 80px;
`

const MCPInfoValue = styled.span`
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  background-color: var(--color-background-soft);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  word-break: break-all;
  flex: 1;
  margin-left: 8px;
`

const ConfirmMessage = styled.div`
  color: var(--color-text);
  line-height: 1.5;
`

const CommandHighlight = styled.span`
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-darker-1));
  color: ${getTextColorOnPrimary()};
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 500;
  font-size: 13px;
  word-break: break-all;
  flex: 1;
  margin-left: 8px;
  box-shadow: 0 2px 4px rgba(22, 119, 255, 0.2);
  border: 1px solid var(--color-primary-border, rgba(22, 119, 255, 0.3));

  /* 添加一个轻微的发光效果 */
  position: relative;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 6px;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05));
    pointer-events: none;
  }
`

export default MCPSettings
