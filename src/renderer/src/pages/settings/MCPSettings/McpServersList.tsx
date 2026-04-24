import { Button, EmptyState, Sortable, Tabs, TabsList, TabsTrigger, useDndReorder } from '@cherrystudio/ui'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { EditIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { matchKeywordsInString } from '@renderer/utils/match'
import type { CreateMCPServerDto } from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { useNavigate } from '@tanstack/react-router'
import { Dropdown } from 'antd'
import { Plus } from 'lucide-react'
import type { FC } from 'react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '..'
import AddMcpServerModal from './AddMcpServerModal'
import InstallNpxUv from './InstallNpxUv'
import McpServerCard from './McpServerCard'

const McpServersList: FC = () => {
  const { mcpServers, addMCPServer, reorderMCPServers } = useMCPServers()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isAddModalVisible, setIsAddModalVisible] = useState(false)
  const [modalType, setModalType] = useState<'json' | 'dxt'>('json')
  const [isEditing, setIsEditing] = useState(false)
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled' | 'stdio' | 'sse' | 'builtin'>('all')

  const [searchText, _setSearchText] = useState('')

  const setSearchText = useCallback((text: string) => {
    startTransition(() => {
      _setSearchText(text)
    })
  }, [])

  const filteredMcpServers = useMemo(() => {
    const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)

    return mcpServers.filter((server) => {
      if (filter === 'enabled' && !server.isActive) return false
      if (filter === 'disabled' && server.isActive) return false
      if (filter === 'stdio' && server.type !== 'stdio') return false
      if (filter === 'sse' && server.type !== 'sse') return false
      if (filter === 'builtin' && server.installSource !== 'builtin') return false

      if (keywords.length === 0) return true

      const searchTarget = `${server.name} ${server.description} ${server.tags?.join(' ')} ${server.provider ?? ''}`
      return matchKeywordsInString(keywords, searchTarget)
    })
  }, [filter, mcpServers, searchText])

  const activeServerCount = useMemo(() => mcpServers.filter((server) => server.isActive).length, [mcpServers])

  const { onSortEnd } = useDndReorder({
    originalList: mcpServers,
    filteredList: filteredMcpServers,
    onUpdate: reorderMCPServers,
    itemKey: 'id'
  })

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

  const onAddMcpServer = useCallback(async () => {
    const newServer = await addMCPServer({
      name: t('settings.mcp.newServer'),
      description: '',
      baseUrl: '',
      command: '',
      args: [],
      env: {},
      isActive: false
    })
    void navigate({ to: `/settings/mcp/settings/${newServer.id}` })
    window.toast.success(t('settings.mcp.addSuccess'))
  }, [addMCPServer, navigate, t])

  const handleAddServerSuccess = useCallback(
    async (dto: CreateMCPServerDto): Promise<MCPServer> => {
      const created = await addMCPServer(dto)
      setIsAddModalVisible(false)
      window.toast.success(t('settings.mcp.addSuccess'))
      return created
    },
    [addMCPServer, t]
  )

  const menuItems = useMemo(
    () => [
      {
        key: 'manual',
        label: t('settings.mcp.addServer.create'),
        onClick: () => {
          void onAddMcpServer()
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
    <Scrollbar
      ref={scrollRef}
      className="flex h-[calc(100vh-var(--navbar-height))] w-full flex-1 flex-col gap-3.75 overflow-hidden overflow-y-auto p-5 pt-3.75">
      <div className="flex w-full items-center justify-between [&_h2]:m-0 [&_h2]:text-[22px]">
        <div className="flex items-center gap-3">
          <SettingTitle>{t('settings.mcp.newServer')}</SettingTitle>
          <span className="text-muted-foreground text-sm">
            {activeServerCount}/{mcpServers.length}
          </span>
          <CollapsibleSearchBar
            onSearch={setSearchText}
            placeholder={t('settings.mcp.search.placeholder')}
            tooltip={t('settings.mcp.search.tooltip')}
            style={{ borderRadius: 20 }}
          />
        </div>
        <div className="flex items-center gap-2">
          <InstallNpxUv mini />
          <Button
            className="h-9 rounded-full px-3.5 shadow-none"
            variant="ghost"
            onClick={() => setIsEditing((value) => !value)}>
            <EditIcon size={14} />
            {isEditing ? t('common.completed') : t('common.edit')}
          </Button>
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <Button className="h-9 rounded-full px-3.5 shadow-none">
              <Plus size={16} />
              {t('common.add')}
            </Button>
          </Dropdown>
        </div>
      </div>
      <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
        <TabsList className="h-auto rounded-full bg-muted/80 p-0.5">
          <TabsTrigger value="all" className="rounded-full px-2.5 py-1 text-xs">
            {t('models.all')}
          </TabsTrigger>
          <TabsTrigger value="enabled" className="rounded-full px-2.5 py-1 text-xs">
            {t('common.enabled')}
          </TabsTrigger>
          <TabsTrigger value="disabled" className="rounded-full px-2.5 py-1 text-xs">
            {t('common.disabled')}
          </TabsTrigger>
          <TabsTrigger value="stdio" className="rounded-full px-2.5 py-1 text-xs">
            STDIO
          </TabsTrigger>
          <TabsTrigger value="sse" className="rounded-full px-2.5 py-1 text-xs">
            SSE
          </TabsTrigger>
          <TabsTrigger value="builtin" className="rounded-full px-2.5 py-1 text-xs">
            {t('settings.mcp.builtinServers')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Sortable
        items={filteredMcpServers}
        itemKey="id"
        onSortEnd={onSortEnd}
        layout="list"
        horizontal={false}
        listStyle={{ display: 'flex', flexDirection: 'column', width: '100%' }}
        itemStyle={{ width: '100%' }}
        gap="4px"
        restrictions={{ scrollableAncestor: true }}
        useDragOverlay
        showGhost
        renderItem={(server) => (
          <McpServerCard
            server={server}
            isEditing={isEditing}
            onEdit={() => navigate({ to: `/settings/mcp/settings/${server.id}` })}
          />
        )}
      />
      {(mcpServers.length === 0 || filteredMcpServers.length === 0) && (
        <EmptyState
          compact
          preset="no-resource"
          description={mcpServers.length === 0 ? t('settings.mcp.noServers') : t('common.no_results')}
          className="mt-5"
        />
      )}

      <AddMcpServerModal
        visible={isAddModalVisible}
        onClose={() => setIsAddModalVisible(false)}
        onSuccess={handleAddServerSuccess}
        existingServers={mcpServers} // 傳遞現有的伺服器列表
        initialImportMethod={modalType}
      />
    </Scrollbar>
  )
}

export default McpServersList
