import { nanoid } from '@reduxjs/toolkit'
import { DraggableList } from '@renderer/components/DraggableList'
import { EditIcon, RefreshIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { MCPServer } from '@renderer/types'
import { formatMcpError } from '@renderer/utils/error'
import { Button, Dropdown, Empty } from 'antd'
import { Plus } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

import { SettingTitle } from '..'
import AddMcpServerModal from './AddMcpServerModal'
import BuiltinMCPServerList from './BuiltinMCPServerList'
import EditMcpJsonPopup from './EditMcpJsonPopup'
import InstallNpxUv from './InstallNpxUv'
import McpMarketList from './McpMarketList'
import McpServerCard from './McpServerCard'
import SyncServersPopup from './SyncServersPopup'

const McpServersList: FC = () => {
  const { mcpServers, addMCPServer, deleteMCPServer, updateMcpServers, updateMCPServer } = useMCPServers()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isAddModalVisible, setIsAddModalVisible] = useState(false)
  const [modalType, setModalType] = useState<'json' | 'dxt'>('json')
  const [loadingServerIds, setLoadingServerIds] = useState<Set<string>>(new Set())
  const [serverVersions, setServerVersions] = useState<Record<string, string | null>>({})

  const scrollRef = useRef<HTMLDivElement>(null)

  // 简单的滚动位置记忆
  useEffect(() => {
    // 恢复滚动位置
    const savedScroll = sessionStorage.getItem('mcp-list-scroll')
    if (savedScroll && scrollRef.current) {
      scrollRef.current.scrollTop = Number(savedScroll)
    }

    // 保存滚动位置
    const handleScroll = () => {
      if (scrollRef.current) {
        sessionStorage.setItem('mcp-list-scroll', String(scrollRef.current.scrollTop))
      }
    }

    const container = scrollRef.current
    container?.addEventListener('scroll', handleScroll)
    return () => container?.removeEventListener('scroll', handleScroll)
  }, [])

  const fetchServerVersion = useCallback(async (server: MCPServer) => {
    if (!server.isActive) return

    try {
      const version = await window.api.mcp.getServerVersion(server)
      setServerVersions((prev) => ({ ...prev, [server.id]: version }))
    } catch (error) {
      setServerVersions((prev) => ({ ...prev, [server.id]: null }))
    }
  }, [])

  // Fetch versions for all active servers
  useEffect(() => {
    mcpServers.forEach((server) => {
      if (server.isActive) {
        fetchServerVersion(server)
      }
    })
  }, [mcpServers, fetchServerVersion])

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
    navigate(`/settings/mcp/settings/${encodeURIComponent(newServer.id)}`)
    window.message.success({ content: t('settings.mcp.addSuccess'), key: 'mcp-list' })
  }, [addMCPServer, navigate, t])

  const onDeleteMcpServer = useCallback(
    async (server: MCPServer) => {
      try {
        window.modal.confirm({
          title: t('settings.mcp.deleteServer'),
          content: t('settings.mcp.deleteServerConfirm'),
          centered: true,
          onOk: async () => {
            await window.api.mcp.removeServer(server)
            deleteMCPServer(server.id)
            window.message.success({ content: t('settings.mcp.deleteSuccess'), key: 'mcp-list' })
          }
        })
      } catch (error: any) {
        window.message.error({
          content: `${t('settings.mcp.deleteError')}: ${error.message}`,
          key: 'mcp-list'
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  )

  const onSyncServers = useCallback(() => {
    SyncServersPopup.show(mcpServers)
  }, [mcpServers])

  const handleAddServerSuccess = useCallback(
    async (server: MCPServer) => {
      addMCPServer(server)
      setIsAddModalVisible(false)
      window.message.success({ content: t('settings.mcp.addSuccess'), key: 'mcp-quick-add' })
      // Optionally navigate to the new server's settings page
      // navigate(`/settings/mcp/settings/${encodeURIComponent(server.id)}`)
    },
    [addMCPServer, t]
  )

  const handleToggleActive = async (server: MCPServer, active: boolean) => {
    setLoadingServerIds((prev) => new Set(prev).add(server.id))
    const oldActiveState = server.isActive

    try {
      if (active) {
        await window.api.mcp.listTools(server)
        // Fetch version when server is activated
        fetchServerVersion({ ...server, isActive: active })
      } else {
        await window.api.mcp.stopServer(server)
        // Clear version when server is deactivated
        setServerVersions((prev) => ({ ...prev, [server.id]: null }))
      }
      updateMCPServer({ ...server, isActive: active })
    } catch (error: any) {
      window.modal.error({
        title: t('settings.mcp.startError'),
        content: formatMcpError(error),
        centered: true
      })
      updateMCPServer({ ...server, isActive: oldActiveState })
    } finally {
      setLoadingServerIds((prev) => {
        const next = new Set(prev)
        next.delete(server.id)
        return next
      })
    }
  }

  const menuItems = useMemo(
    () => [
      {
        key: 'manual',
        label: t('settings.mcp.addServer.create'),
        onClick: () => {
          onAddMcpServer()
        }
      },
      {
        key: 'json',
        label: t('settings.mcp.addServer.importFrom.json'),
        onClick: () => {
          setModalType('json')
          setIsAddModalVisible(true)
        }
      },
      {
        key: 'dxt',
        label: t('settings.mcp.addServer.importFrom.dxt'),
        onClick: () => {
          setModalType('dxt')
          setIsAddModalVisible(true)
        }
      }
    ],
    [onAddMcpServer, t]
  )

  return (
    <Container ref={scrollRef}>
      <ListHeader>
        <SettingTitle style={{ gap: 3 }}>
          <span>{t('settings.mcp.newServer')}</span>
          <Button icon={<EditIcon size={14} />} type="text" onClick={() => EditMcpJsonPopup.show()} shape="circle" />
        </SettingTitle>
        <ButtonGroup>
          <InstallNpxUv mini />
          <Dropdown
            menu={{
              items: menuItems
            }}
            trigger={['click']}>
            <Button icon={<Plus size={16} />} type="default" shape="round">
              {t('settings.mcp.addServer.label')}
            </Button>
          </Dropdown>
          <Button icon={<RefreshIcon size={16} />} type="default" onClick={onSyncServers} shape="round">
            {t('settings.mcp.sync.title', 'Sync Servers')}
          </Button>
        </ButtonGroup>
      </ListHeader>
      <DraggableList
        style={{ width: '100%' }}
        list={mcpServers}
        onUpdate={updateMcpServers}
        listProps={{
          locale: {
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('settings.mcp.noServers')}
                style={{ marginTop: 20 }}
              />
            )
          }
        }}>
        {(server: MCPServer) => (
          <div onClick={() => navigate(`/settings/mcp/settings/${encodeURIComponent(server.id)}`)}>
            <McpServerCard
              server={server}
              version={serverVersions[server.id]}
              isLoading={loadingServerIds.has(server.id)}
              onToggle={(active) => handleToggleActive(server, active)}
              onDelete={() => onDeleteMcpServer(server)}
              onEdit={() => navigate(`/settings/mcp/settings/${encodeURIComponent(server.id)}`)}
              onOpenUrl={(url) => window.open(url, '_blank')}
            />
          </div>
        )}
      </DraggableList>

      <McpMarketList />
      <BuiltinMCPServerList />

      <AddMcpServerModal
        visible={isAddModalVisible}
        onClose={() => setIsAddModalVisible(false)}
        onSuccess={handleAddServerSuccess}
        existingServers={mcpServers} // 傳遞現有的伺服器列表
        initialImportMethod={modalType}
      />
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

const ButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

export default McpServersList
