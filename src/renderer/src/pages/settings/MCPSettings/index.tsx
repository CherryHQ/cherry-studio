import { ArrowLeftOutlined, CodeOutlined, PlusOutlined } from '@ant-design/icons'
import { nanoid } from '@reduxjs/toolkit'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { HStack, VStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { EventEmitter } from '@renderer/services/EventService'
import { MCPServer } from '@renderer/types'
import { isEmpty } from 'lodash'
import { FC, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer } from '..'
import InstallNpxUv from './InstallNpxUv'
import McpSettings from './McpSettings'
import NpxSearch from './NpxSearch'

const MCPSettings: FC = () => {
  const { t } = useTranslation()
  const { mcpServers, addMCPServer } = useMCPServers()
  const [selectedMcpServer, setSelectedMcpServer] = useState<MCPServer | null>(null)
  const [route, setRoute] = useState<'npx-search' | 'mcp-install' | null>(null)
  const { theme } = useTheme()

  useEffect(() => {
    const unsubs = [
      EventEmitter.on('mcp:npx-search', () => setRoute('npx-search')),
      EventEmitter.on('mcp:mcp-install', () => setRoute('mcp-install'))
    ]
    return () => unsubs.forEach((unsub) => unsub())
  }, [])

  const onAddMcpServer = async () => {
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
    setRoute(null)
  }

  useEffect(() => {
    const _selectedMcpServer = mcpServers.find((server) => server.id === selectedMcpServer?.id)
    setSelectedMcpServer(_selectedMcpServer || mcpServers[0])
  }, [mcpServers, route, selectedMcpServer])

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

  const MainContent = useMemo(() => {
    if (route === 'npx-search' || isEmpty(mcpServers)) {
      return (
        <SettingContainer theme={theme}>
          <NpxSearch />
        </SettingContainer>
      )
    }

    if (route === 'mcp-install') {
      return (
        <SettingContainer theme={theme}>
          <InstallNpxUv />
        </SettingContainer>
      )
    }
    if (selectedMcpServer) {
      return <McpSettings server={selectedMcpServer} />
    }

    return <NpxSearch />
  }, [mcpServers, route, selectedMcpServer, theme])

  const goBackToGrid = () => {
    setSelectedMcpServer(null)
  }

  return (
    <Container>
      {selectedMcpServer ? (
        <DetailViewContainer>
          <BackButtonContainer>
            <BackButton onClick={goBackToGrid}>
              <ArrowLeftOutlined /> {t('common.back')}
            </BackButton>
          </BackButtonContainer>
          <DetailContent>{MainContent}</DetailContent>
        </DetailViewContainer>
      ) : (
        <GridContainer>
          <GridHeader>
            <h2>{t('settings.mcp.newServer')}</h2>
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
                  setRoute(null)
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
                  {server.description
                    ? server.description.substring(0, 60) + (server.description.length > 60 ? '...' : '')
                    : t('settings.mcp.noDescription')}
                </ServerDescription>
              </ServerCard>
            ))}
          </ServersGrid>
        </GridContainer>
      )}
    </Container>
  )
}

const Container = styled(HStack)`
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

const DetailViewContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  position: relative;
`

const BackButtonContainer = styled.div`
  padding: 16px 0 0 20px;
  width: 100%;
`

const DetailContent = styled.div`
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
