import { ArrowLeftOutlined, CodeOutlined, PlusOutlined } from '@ant-design/icons'
import { nanoid } from '@reduxjs/toolkit'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { VStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPServer } from '@renderer/types'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { SettingContainer, SettingTitle } from '..'
import InstallNpxUv from './InstallNpxUv'
import McpSettings from './McpSettings'
import NpxSearch from './NpxSearch'

const MCPSettings: FC = () => {
  const { t } = useTranslation()
  const { mcpServers, addMCPServer } = useMCPServers()
  const [selectedMcpServer, setSelectedMcpServer] = useState<MCPServer | null>(null)
  const { theme } = useTheme()
  const navigate = useNavigate()

  const location = useLocation()
  const pathname = location.pathname

  const onAddMcpServer = useCallback(async () => {
    const newServer = {
      id: nanoid(),
      name: t('settings.mcp.newServer'),
      description: '',
      baseUrl: '',
      command: '',
      args: [],
      env: {},
      isActive: false
    }
    addMCPServer(newServer)
    window.message.success({ content: t('settings.mcp.addSuccess'), key: 'mcp-list' })
    setSelectedMcpServer(newServer)
  }, [addMCPServer, t])

  useEffect(() => {
    const _selectedMcpServer = mcpServers.find((server) => server.id === selectedMcpServer?.id)
    setSelectedMcpServer(_selectedMcpServer || mcpServers[0])
  }, [mcpServers, selectedMcpServer])

  useEffect(() => {
    // Check if the selected server still exists in the updated mcpServers list
    if (selectedMcpServer) {
      const serverExists = mcpServers.some((server) => server.id === selectedMcpServer.id)
      if (!serverExists) {
        setSelectedMcpServer(null)
      }
    } else {
      setSelectedMcpServer(null)
    }
  }, [mcpServers, selectedMcpServer])

  const McpServersList = useCallback(
    () => (
      <GridContainer>
        <GridHeader>
          <SettingTitle>{t('settings.mcp.newServer')}</SettingTitle>
        </GridHeader>
        <ServersGrid>
          <AddServerCard onClick={onAddMcpServer}>
            <PlusOutlined style={{ fontSize: 24 }} />
            <AddServerText>{t('settings.mcp.addServer')}</AddServerText>
          </AddServerCard>
          {mcpServers.map((server) => (
            <ServerCard
              key={server.id}
              onClick={() => {
                setSelectedMcpServer(server)
                navigate(`/settings/mcp/server/${server.id}`)
              }}>
              <ServerHeader>
                <ServerIcon>
                  <CodeOutlined />
                </ServerIcon>
                <ServerName>{server.name}</ServerName>
                <StatusIndicator>
                  <IndicatorLight
                    size={6}
                    color={server.isActive ? 'green' : 'var(--color-text-3)'}
                    animation={server.isActive}
                    shadow={false}
                  />
                </StatusIndicator>
              </ServerHeader>
              <ServerDescription>
                {server.description &&
                  server.description.substring(0, 60) + (server.description.length > 60 ? '...' : '')}
              </ServerDescription>
            </ServerCard>
          ))}
        </ServersGrid>
      </GridContainer>
    ),
    [mcpServers, navigate, onAddMcpServer, t]
  )

  const isHome = pathname === '/settings/mcp'

  return (
    <Container>
      {!isHome && (
        <BackButtonContainer>
          <Link to="/settings/mcp">
            <BackButton>
              <ArrowLeftOutlined /> {t('common.back')}
            </BackButton>
          </Link>
        </BackButtonContainer>
      )}
      <MainContainer>
        <Routes>
          <Route path="/" element={<McpServersList />} />
          <Route path="server/:id" element={selectedMcpServer ? <McpSettings server={selectedMcpServer} /> : null} />
          <Route
            path="npx-search"
            element={
              <SettingContainer theme={theme}>
                <NpxSearch setSelectedMcpServer={setSelectedMcpServer} />
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
    </Container>
  )
}

const Container = styled(VStack)`
  flex: 1;
`

const GridContainer = styled(VStack)`
  width: 100%;
  height: calc(100vh - var(--navbar-height));
  padding: 20px;
`

const GridHeader = styled.div`
  width: 100%;
  padding-bottom: 16px;

  h2 {
    font-size: 20px;
    margin: 0;
  }
`

const ServersGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  width: 100%;
  overflow-y: auto;
  padding: 2px;
`

const ServerCard = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  height: 140px;
  background-color: var(--color-bg-1);

  &:hover {
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
  }
`

const ServerHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 12px;
`

const ServerIcon = styled.div`
  font-size: 18px;
  color: var(--color-primary);
  margin-right: 8px;
`

const ServerName = styled.div`
  font-weight: 500;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const StatusIndicator = styled.div`
  margin-left: 8px;
`

const ServerDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
`

const AddServerCard = styled(ServerCard)`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  border-style: dashed;
  background-color: transparent;
  color: var(--color-text-2);
`

const AddServerText = styled.div`
  margin-top: 12px;
  font-weight: 500;
`

const BackButtonContainer = styled.div`
  padding: 12px 0 0 12px;
  width: 100%;
  background-color: var(--color-background);
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
`

const BackButton = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-1);
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 4px;
  margin-bottom: 10px;
  background-color: var(--color-bg-1);

  &:hover {
    color: var(--color-primary);
    background-color: var(--color-bg-2);
  }
`

export default MCPSettings
