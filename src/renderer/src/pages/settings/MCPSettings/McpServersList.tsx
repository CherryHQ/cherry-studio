import {
  Button,
  EmptyState,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sortable,
  Tabs,
  TabsList,
  TabsTrigger,
  useDndReorder
} from '@cherrystudio/ui'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { EditIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { matchKeywordsInString } from '@renderer/utils/match'
import type { CreateMCPServerDto } from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import type { FC } from 'react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '..'
import AddMcpServerModal from './AddMcpServerModal'
import EnvironmentDependencies from './EnvironmentDependencies'
import McpServerCard from './McpServerCard'

const McpServersList: FC = () => {
  const { mcpServers, addMCPServer, reorderMCPServers } = useMCPServers()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isAddModalVisible, setIsAddModalVisible] = useState(false)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
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

  const handleManualAdd = useCallback(() => {
    setIsAddMenuOpen(false)
    void onAddMcpServer()
  }, [onAddMcpServer])

  const handleImportJson = useCallback(() => {
    setIsAddMenuOpen(false)
    setModalType('json')
    setIsAddModalVisible(true)
  }, [])

  const handleImportDxt = useCallback(() => {
    setIsAddMenuOpen(false)
    setModalType('dxt')
    setIsAddModalVisible(true)
  }, [])

  return (
    <div className="flex h-[calc(100vh-var(--navbar-height))] w-full min-w-0 flex-1 flex-col gap-2 overflow-hidden px-5 py-4">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <SettingTitle>{t('settings.mcp.newServer')}</SettingTitle>
            <span className="shrink-0 text-muted-foreground text-sm">
              {activeServerCount}/{mcpServers.length}
            </span>
          </div>
          <CollapsibleSearchBar
            onSearch={setSearchText}
            placeholder={t('settings.mcp.search.placeholder')}
            tooltip={t('settings.mcp.search.tooltip')}
            icon={<Search size={15} className="text-muted-foreground" />}
            maxWidth={200}
            style={{ borderRadius: 16 }}
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <EnvironmentDependencies mini />
          <Button
            variant="ghost"
            className="h-8 rounded-lg px-2.5 text-xs shadow-none"
            onClick={() => setIsEditing((value) => !value)}>
            <EditIcon size={14} />
            {isEditing ? t('common.completed') : t('common.edit')}
          </Button>
          <Popover open={isAddMenuOpen} onOpenChange={setIsAddMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" className="h-8 rounded-lg px-2.5 text-xs shadow-none">
                <Plus size={15} />
                {t('common.add')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" side="bottom" className="w-auto p-1">
              <MenuList className="gap-1">
                <MenuItem label={t('settings.mcp.addServer.create')} onClick={handleManualAdd} />
                <MenuItem label={t('settings.mcp.addServer.importFrom.json')} onClick={handleImportJson} />
                <MenuItem label={t('settings.mcp.addServer.importFrom.dxt')} onClick={handleImportDxt} />
              </MenuList>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)} className="hidden xl:block">
          <TabsList className="h-8 rounded-full bg-muted/70 p-0.5">
            <TabsTrigger value="all" className="h-7 rounded-[14px] px-2.5 text-xs">
              {t('models.all')}
            </TabsTrigger>
            <TabsTrigger value="enabled" className="h-7 rounded-[14px] px-2.5 text-xs">
              {t('common.enabled')}
            </TabsTrigger>
            <TabsTrigger value="disabled" className="h-7 rounded-[14px] px-2.5 text-xs">
              {t('common.disabled')}
            </TabsTrigger>
            <TabsTrigger value="stdio" className="h-7 rounded-[14px] px-2.5 text-xs">
              STDIO
            </TabsTrigger>
            <TabsTrigger value="sse" className="h-7 rounded-[14px] px-2.5 text-xs">
              SSE
            </TabsTrigger>
            <TabsTrigger value="builtin" className="h-7 rounded-[14px] px-2.5 text-xs">
              {t('settings.mcp.builtinServers')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-border/70">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <Scrollbar ref={scrollRef} className="min-h-0 flex-1">
              {filteredMcpServers.length > 0 ? (
                <Sortable
                  className="[&>div:last-child_[data-slot=mcp-server-row]]:border-b-0"
                  items={filteredMcpServers}
                  itemKey="id"
                  onSortEnd={onSortEnd}
                  layout="list"
                  horizontal={false}
                  listStyle={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 0 }}
                  itemStyle={{ width: '100%' }}
                  gap={0}
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
              ) : (
                <EmptyState
                  compact
                  preset="no-resource"
                  description={mcpServers.length === 0 ? t('settings.mcp.noServers') : t('common.no_results')}
                  className="py-12"
                />
              )}
            </Scrollbar>
          </div>
        </div>
      </div>

      <AddMcpServerModal
        visible={isAddModalVisible}
        onClose={() => setIsAddModalVisible(false)}
        onSuccess={handleAddServerSuccess}
        existingServers={mcpServers} // 傳遞現有的伺服器列表
        initialImportMethod={modalType}
      />
    </div>
  )
}

export default McpServersList
