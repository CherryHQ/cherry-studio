import { ArrowLeftOutlined } from '@ant-design/icons'
import { VStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPServer } from '@renderer/types'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Routes, useLocation } from 'react-router'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { SettingContainer } from '..'
import InstallNpxUv from './InstallNpxUv'
import McpServersList from './McpServersList'
import NpxSearch from './NpxSearch'

const MCPSettings: FC = () => {
  const { t } = useTranslation()
  const { mcpServers } = useMCPServers()
  const [selectedMcpServer, setSelectedMcpServer] = useState<MCPServer | null>(mcpServers[0])
  const { theme } = useTheme()

  const location = useLocation()
  const pathname = location.pathname

  useEffect(() => {
    const _selectedMcpServer = mcpServers.find((server) => server.id === selectedMcpServer?.id)
    setSelectedMcpServer(_selectedMcpServer || mcpServers[0])
  }, [mcpServers, selectedMcpServer])

  // Check if the selected server still exists in the updated mcpServers list
  useEffect(() => {
    if (selectedMcpServer) {
      const serverExists = mcpServers.some((server) => server.id === selectedMcpServer.id)
      if (!serverExists) {
        setSelectedMcpServer(mcpServers[0])
      }
    }
  }, [mcpServers, selectedMcpServer])

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
          <Route
            path="/"
            element={
              <McpServersList selectedMcpServer={selectedMcpServer} setSelectedMcpServer={setSelectedMcpServer} />
            }
          />
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
