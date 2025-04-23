import { CodeOutlined, PlusOutlined } from '@ant-design/icons'
import { nanoid } from '@reduxjs/toolkit'
import DragableList from '@renderer/components/DragableList'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { HStack, VStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPServer } from '@renderer/types'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingTitle } from '..'
import McpSettings from './McpSettings'

interface Props {
  selectedMcpServer: MCPServer | null
  setSelectedMcpServer: (server: MCPServer | null) => void
}

const McpServersList: FC<Props> = ({ selectedMcpServer, setSelectedMcpServer }) => {
  const { mcpServers, addMCPServer, updateMcpServers } = useMCPServers()
  const { t } = useTranslation()

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
  }, [addMCPServer, setSelectedMcpServer, t])

  return (
    <Container>
      <ServersList>
        <ListHeader>
          <SettingTitle>{t('settings.mcp.newServer')}</SettingTitle>
        </ListHeader>
        <AddServerCard onClick={onAddMcpServer}>
          <PlusOutlined style={{ fontSize: 24 }} />
          <AddServerText>{t('settings.mcp.addServer')}</AddServerText>
        </AddServerCard>
        <DragableList list={mcpServers} onUpdate={updateMcpServers}>
          {(server) => (
            <ServerCard
              key={server.id}
              onClick={() => setSelectedMcpServer(server)}
              className={selectedMcpServer?.id === server.id ? 'active' : ''}>
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
              <ServerDescription>{server.description}</ServerDescription>
            </ServerCard>
          )}
        </DragableList>
      </ServersList>
      <ServerSettings>{selectedMcpServer && <McpSettings server={selectedMcpServer} />}</ServerSettings>
    </Container>
  )
}

const Container = styled(HStack)`
  flex: 1;
  width: 350px;
  height: calc(100vh - var(--navbar-height));
  overflow: hidden;
`

const ServersList = styled(Scrollbar)`
  gap: 16px;
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
  width: 350px;
  padding: 15px;
  border-right: 0.5px solid var(--color-border);
`

const ServerSettings = styled(VStack)`
  flex: 1;
  height: calc(100vh - var(--navbar-height));
`

const ListHeader = styled.div`
  width: 100%;

  h2 {
    font-size: 20px;
    margin: 0;
  }
`

const ServerCard = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  height: 120px;
  background-color: var(--color-background);

  &:hover,
  &.active {
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
  }
`

const ServerHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 5px;
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
  width: 100%;
  word-break: break-word;
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

export default McpServersList
