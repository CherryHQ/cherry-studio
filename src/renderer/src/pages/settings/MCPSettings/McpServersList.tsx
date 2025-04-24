import { EditOutlined } from '@ant-design/icons'
import { nanoid } from '@reduxjs/toolkit'
import DragableList from '@renderer/components/DragableList'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPServer } from '@renderer/types'
import { Button, Empty, Tag } from 'antd'
import { MonitorCheck, Plus, Settings2 } from 'lucide-react'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

import { SettingTitle } from '..'
import EditMcpJsonPopup from './EditMcpJsonPopup'
const McpServersList: FC = () => {
  const { mcpServers, addMCPServer, updateMcpServers } = useMCPServers()
  const { t } = useTranslation()
  const navigate = useNavigate()

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
    await addMCPServer(newServer)
    navigate(`/settings/mcp/settings`, { state: { server: newServer } })
    window.message.success({ content: t('settings.mcp.addSuccess'), key: 'mcp-list' })
  }, [addMCPServer, navigate, t])

  return (
    <Container>
      <ListHeader>
        <SettingTitle style={{ gap: 3 }}>
          <span>{t('settings.mcp.newServer')}</span>
          <Button icon={<EditOutlined />} type="text" onClick={() => EditMcpJsonPopup.show()} shape="circle" />
        </SettingTitle>
        <Button icon={<Plus size={16} />} type="default" onClick={onAddMcpServer} shape="round">
          {t('settings.mcp.addServer')}
        </Button>
      </ListHeader>
      <DragableList style={{ width: '100%' }} list={mcpServers} onUpdate={updateMcpServers}>
        {(server: MCPServer) => (
          <ServerCard key={server.id} onClick={() => navigate(`/settings/mcp/settings`, { state: { server } })}>
            <ServerHeader>
              <ServerName>
                <ServerNameText>{server.name}</ServerNameText>
                <ServerIcon>
                  <MonitorCheck size={16} color={server.isActive ? 'var(--color-primary)' : 'var(--color-text-3)'} />
                </ServerIcon>
              </ServerName>
              <StatusIndicator>
                <Button
                  icon={<Settings2 size={16} />}
                  type="text"
                  onClick={() => navigate(`/settings/mcp/settings`, { state: { server } })}
                />
              </StatusIndicator>
            </ServerHeader>
            <ServerDescription>{server.description}</ServerDescription>
            <ServerFooter>
              <Tag color="default" style={{ borderRadius: 20, margin: 0 }}>
                {t(`settings.mcp.types.${server.type || 'stdio'}`)}
              </Tag>
            </ServerFooter>
          </ServerCard>
        )}
      </DragableList>
      {mcpServers.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('settings.mcp.noServers')}
          style={{ marginTop: 20 }}
        />
      )}
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  height: calc(100vh - var(--navbar-height));
  overflow: hidden;
  padding: 20px;
  padding-top: 15px;
  gap: 15px;
  overflow-y: auto;
`

const ListHeader = styled.div`
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;

  h2 {
    font-size: 22px;
    margin: 0;
  }
`

const ServerCard = styled.div`
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--color-border);
  border-radius: var(--list-item-border-radius);
  padding: 10px 16px;
  transition: all 0.2s ease;
  background-color: var(--color-background);
  margin-bottom: 5px;
  height: 125px;
  cursor: pointer;

  &:hover {
    border-color: var(--color-primary);
  }
`

const ServerHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 5px;
`

const ServerIcon = styled.div`
  font-size: 18px;
  margin-right: 8px;
  display: flex;
`

const ServerName = styled.div`
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 10px;
`

const ServerNameText = styled.span`
  font-size: 15px;
  font-weight: 500;
  font-family: Ubuntu;
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
  height: 50px;
`

const ServerFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
`

export default McpServersList
