import {
  Button,
  EmptyState,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sortable,
  useDndReorder
} from '@cherrystudio/ui'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { matchKeywordsInString } from '@renderer/utils/match'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { useNavigate } from '@tanstack/react-router'
import { Check, Filter, Plus } from 'lucide-react'
import type { FC } from 'react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '..'
import AddMcpServerModal from './AddMcpServerModal'
import EnvironmentDependencies from './EnvironmentDependencies'
import McpServerCard from './McpServerCard'

type ImportMethod = 'json' | 'dxt' | 'mcpb'
type McpServerFilter = 'all' | 'enabled' | 'disabled' | 'stdio' | 'sse' | 'builtin'

const FILTER_OPTIONS: { value: McpServerFilter; labelKey?: string; label?: string }[] = [
  { value: 'all', labelKey: 'models.all' },
  { value: 'enabled', labelKey: 'common.enabled' },
  { value: 'disabled', labelKey: 'common.disabled' },
  { value: 'stdio', label: 'STDIO' },
  { value: 'sse', label: 'SSE' },
  { value: 'builtin', labelKey: 'settings.mcp.builtinServers' }
]

const McpServersList: FC = () => {
  const { mcpServers, addMcpServer, reorderMcpServers } = useMcpServers()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isAddModalVisible, setIsAddModalVisible] = useState(false)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false)
  const [modalType, setModalType] = useState<ImportMethod>('json')
  const [filter, setFilter] = useState<McpServerFilter>('all')

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
    onUpdate: reorderMcpServers,
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
    const newServer = await addMcpServer({
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
  }, [addMcpServer, navigate, t])

  const handleAddServerSuccess = useCallback(
    async (dto: CreateMcpServerDto): Promise<McpServer> => {
      const created = await addMcpServer(dto)
      setIsAddModalVisible(false)
      window.toast.success(t('settings.mcp.addSuccess'))
      return created
    },
    [addMcpServer, t]
  )

  const handleManualAdd = useCallback(() => {
    setIsAddMenuOpen(false)
    void onAddMcpServer()
  }, [onAddMcpServer])

  const handleImport = useCallback((importMethod: ImportMethod) => {
    setIsAddMenuOpen(false)
    setModalType(importMethod)
    setIsAddModalVisible(true)
  }, [])

  return (
    <div className="flex h-[calc(100vh-var(--navbar-height))] w-full min-w-0 flex-1 flex-col gap-2 overflow-hidden px-6 py-4 pt-3">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2">
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <SettingTitle>{t('settings.mcp.allServers')}</SettingTitle>
              <span className="shrink-0 text-muted-foreground text-sm">
                {activeServerCount}/{mcpServers.length}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Popover open={isFilterMenuOpen} onOpenChange={setIsFilterMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('settings.mcp.filter.label')}
                    className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-accent">
                    <Filter
                      size={14}
                      color={filter === 'all' ? 'var(--color-icon)' : undefined}
                      className={filter === 'all' ? undefined : 'text-primary'}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="bottom" className="w-auto min-w-36 p-1">
                  <MenuList className="gap-1">
                    {FILTER_OPTIONS.map((option) => (
                      <MenuItem
                        key={option.value}
                        label={option.label ?? t(option.labelKey!)}
                        className="h-8 rounded-lg px-2.5 text-sm"
                        icon={
                          <Check className={filter === option.value ? 'size-3.5 opacity-100' : 'size-3.5 opacity-0'} />
                        }
                        onClick={() => {
                          setFilter(option.value)
                          setIsFilterMenuOpen(false)
                        }}
                      />
                    ))}
                  </MenuList>
                </PopoverContent>
              </Popover>
              <CollapsibleSearchBar
                onSearch={setSearchText}
                placeholder={t('settings.mcp.search.placeholder')}
                tooltip={t('settings.mcp.search.tooltip')}
                maxWidth={200}
                collapsedSize={28}
                animated={false}
                style={{ borderRadius: 14 }}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <EnvironmentDependencies mini />
            <Popover open={isAddMenuOpen} onOpenChange={setIsAddMenuOpen}>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="sm" className="rounded-lg text-xs shadow-none">
                  <Plus size={15} />
                  {t('common.add')}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-auto p-1">
                <MenuList className="gap-1">
                  <MenuItem label={t('settings.mcp.addServer.create')} onClick={handleManualAdd} />
                  <MenuItem label={t('settings.mcp.addServer.importFrom.json')} onClick={() => handleImport('json')} />
                  <MenuItem label={t('settings.mcp.addServer.importFrom.dxt')} onClick={() => handleImport('dxt')} />
                  <MenuItem label={t('settings.mcp.addServer.importFrom.mcpb')} onClick={() => handleImport('mcpb')} />
                </MenuList>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
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
                    animateLayoutChanges={false}
                    listStyle={{ gap: 0 }}
                    itemStyle={{ transition: 'none' }}
                    gap={0}
                    restrictions={{ scrollableAncestor: true }}
                    useDragOverlay
                    showGhost
                    renderItem={(server) => (
                      <McpServerCard
                        server={server}
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
