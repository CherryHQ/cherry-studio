import { CodeOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { nanoid } from '@reduxjs/toolkit'
import DragableList from '@renderer/components/DragableList'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { HStack } from '@renderer/components/Layout'
import ListItem from '@renderer/components/ListItem'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { EventEmitter } from '@renderer/services/EventService'
import { MCPServer } from '@renderer/types'
import { Dropdown, MenuProps } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer } from '..'
import InstallNpxUv from './InstallNpxUv'
import McpSettings from './McpSettings'
import NpxSearch from './NpxSearch'

const MCPSettings: FC = () => {
  const { t } = useTranslation()
  const { mcpServers, addMCPServer, updateMcpServers, deleteMCPServer } = useMCPServers()
  const [selectedMcpServer, setSelectedMcpServer] = useState<MCPServer | null>(mcpServers[0])
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
  }

  const onDeleteMcpServer = useCallback(
    async (server: MCPServer) => {
      try {
        await window.api.mcp.removeServer(server)
        await deleteMCPServer(server.id)
        window.message.success({ content: t('settings.mcp.deleteSuccess'), key: 'mcp-list' })
      } catch (error: any) {
        window.message.error({
          content: `${t('settings.mcp.deleteError')}: ${error.message}`,
          key: 'mcp-list'
        })
      }
    },
    [deleteMCPServer, t]
  )

  const getMenuItems = useCallback(
    (server: MCPServer) => {
      const menus: MenuProps['items'] = [
        {
          label: t('common.delete'),
          danger: true,
          key: 'delete',
          icon: <DeleteOutlined />,
          onClick: () => onDeleteMcpServer(server)
        }
      ]
      return menus
    },
    [onDeleteMcpServer, t]
  )

  useEffect(() => {
    const _selectedMcpServer = mcpServers.find((server) => server.id === selectedMcpServer?.id)
    setSelectedMcpServer(_selectedMcpServer || mcpServers[0])
  }, [mcpServers, route, selectedMcpServer])

  const MainContent = useCallback(() => {
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

  return (
    <Container>
      <McpList>
        <ListItem
          key="add"
          title={t('settings.mcp.addServer')}
          active={false}
          onClick={onAddMcpServer}
          icon={<PlusOutlined />}
          titleStyle={{ fontWeight: 500 }}
          style={{ marginBottom: 5 }}
        />
        <DragableList list={mcpServers} onUpdate={updateMcpServers}>
          {(server: MCPServer) => (
            <Dropdown menu={{ items: getMenuItems(server) }} trigger={['contextMenu']} key={server.id}>
              <div>
                <ListItem
                  key={server.id}
                  title={server.name}
                  active={selectedMcpServer?.id === server.id}
                  onClick={() => {
                    setSelectedMcpServer(server)
                    setRoute(null)
                  }}
                  titleStyle={{ fontWeight: 500 }}
                  icon={<CodeOutlined />}
                  rightContent={
                    <IndicatorLight
                      size={6}
                      color={server.isActive ? 'green' : 'var(--color-text-3)'}
                      animation={server.isActive}
                      shadow={false}
                      style={{ marginRight: 4 }}
                    />
                  }
                />
              </div>
            </Dropdown>
          )}
        </DragableList>
      </McpList>
      <MainContent />
    </Container>
  )
}

const Container = styled(HStack)`
  flex: 1;
`

const McpList = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: var(--settings-width);
  padding: 12px;
  border-right: 0.5px solid var(--color-border);
  height: calc(100vh - var(--navbar-height));
  .iconfont {
    color: var(--color-text-2);
    line-height: 16px;
  }
`

export default MCPSettings
