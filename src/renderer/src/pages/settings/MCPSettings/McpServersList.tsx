import { nanoid } from '@reduxjs/toolkit'
import { DraggableList } from '@renderer/components/DraggableList'
import { EditIcon, RefreshIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { getMcpTypeLabel } from '@renderer/i18n/label'
import { MCPServer } from '@renderer/types'
import { formatMcpError } from '@renderer/utils/error'
import { Badge, Button, Dropdown, Empty, Switch, Tag } from 'antd'
import { MonitorCheck, Plus, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

import { SettingTitle } from '..'
import AddMcpServerModal from './AddMcpServerModal'
import BuiltinMCPServersSection from './BuiltinMCPServersSection'
import EditMcpJsonPopup from './EditMcpJsonPopup'
import InstallNpxUv from './InstallNpxUv'
import McpResourcesSection from './McpResourcesSection'
import SyncServersPopup from './SyncServersPopup'

const McpServersList: FC = () => {
  const { mcpServers, addMCPServer, updateMcpServers, updateMCPServer } = useMCPServers()
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
              items: [
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
              ]
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
      <DraggableList style={{ width: '100%' }} list={mcpServers} onUpdate={updateMcpServers}>
        {(server: MCPServer) => (
          <ServerCard
            key={server.id}
            onClick={() => navigate(`/settings/mcp/settings/${encodeURIComponent(server.id)}`)}>
            <ServerHeader>
              <ServerName>
                {server.logoUrl && <ServerLogo src={server.logoUrl} alt={`${server.name} logo`} />}
                <ServerNameText>{server.name}</ServerNameText>
                {serverVersions[server.id] && <VersionBadge count={serverVersions[server.id]} color="blue" />}
                {server.providerUrl && (
                  <Button
                    size="small"
                    type="text"
                    onClick={() => window.open(server.providerUrl, '_blank')}
                    icon={<SquareArrowOutUpRight size={14} />}
                    className="nodrag"
                    style={{ fontSize: 13, height: 28, borderRadius: 20 }}></Button>
                )}
                <ServerIcon>
                  <MonitorCheck size={16} color={server.isActive ? 'var(--color-primary)' : 'var(--color-text-3)'} />
                </ServerIcon>
              </ServerName>
              <StatusIndicator onClick={(e) => e.stopPropagation()}>
                <Switch
                  value={server.isActive}
                  key={server.id}
                  loading={loadingServerIds.has(server.id)}
                  onChange={(checked) => handleToggleActive(server, checked)}
                  size="small"
                />
                <Button
                  icon={<Settings2 size={16} />}
                  type="text"
                  onClick={() => navigate(`/settings/mcp/settings/${encodeURIComponent(server.id)}`)}
                />
              </StatusIndicator>
            </ServerHeader>
            <ServerDescription>{server.description}</ServerDescription>
            <ServerFooter>
              <Tag color="processing" style={{ borderRadius: 20, margin: 0, fontWeight: 500 }}>
                {getMcpTypeLabel(server.type ?? 'stdio')}
              </Tag>
              {server.provider && (
                <Tag color="success" style={{ borderRadius: 20, margin: 0, fontWeight: 500 }}>
                  {server.provider}
                </Tag>
              )}
              {server.tags
                ?.filter((tag): tag is string => typeof tag === 'string')
                .map((tag) => (
                  <Tag key={tag} color="default" style={{ borderRadius: 20, margin: 0 }}>
                    {tag}
                  </Tag>
                ))}
            </ServerFooter>
          </ServerCard>
        )}
      </DraggableList>
      {mcpServers.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('settings.mcp.noServers')}
          style={{ marginTop: 20 }}
        />
      )}

      <McpResourcesSection />
      <BuiltinMCPServersSection />

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

const ServerLogo = styled.img`
  width: 24px;
  height: 24px;
  border-radius: 4px;
  object-fit: cover;
  margin-right: 8px;
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
  gap: 4px;
`

const ServerNameText = styled.span`
  font-size: 15px;
  font-weight: 500;
`

const StatusIndicator = styled.div`
  margin-left: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
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
  gap: 4px;
  justify-content: flex-start;
  margin-top: 10px;
`

const ButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const VersionBadge = styled(Badge)`
  .ant-badge-count {
    background-color: var(--color-primary);
    color: white;
    font-size: 10px;
    font-weight: 500;
    padding: 0 5px;
    height: 16px;
    line-height: 16px;
    border-radius: 8px;
    min-width: 16px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
`

export default McpServersList
