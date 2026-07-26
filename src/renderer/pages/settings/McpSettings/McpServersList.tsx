import {
  Button,
  EmptyState,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar,
  SearchInput,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sortable,
  Switch,
  useDndReorder
} from '@cherrystudio/ui'
import { SettingDescription, SettingDivider, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import EnvironmentDependencies from '@renderer/pages/settings/DependenciesSettings/EnvironmentDependencies'
import { toast } from '@renderer/services/toast'
import { matchKeywordsInString } from '@renderer/utils/match'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, Plus } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AddMcpServerModal from './AddMcpServerModal'
import McpServerCard from './McpServerCard'
import QuickCreateMcpServerDialog from './QuickCreateMcpServerDialog'

type ImportMethod = 'json' | 'dxt' | 'mcpb'
type StatusFilter = 'all' | 'enabled' | 'disabled'
type TypeFilter = 'all' | 'stdio' | 'sse' | 'streamableHttp'

const STATUS_OPTIONS: { value: StatusFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'settings.mcp.filter.allStatuses' },
  { value: 'enabled', labelKey: 'common.enabled' },
  { value: 'disabled', labelKey: 'common.disabled' }
]

const TYPE_OPTIONS: { value: TypeFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'settings.mcp.filter.allTypes' },
  { value: 'stdio', labelKey: 'settings.mcp.types.stdio' },
  { value: 'sse', labelKey: 'settings.mcp.types.sse' },
  { value: 'streamableHttp', labelKey: 'settings.mcp.types.streamableHttp' }
]

const McpServersList: FC = () => {
  const { mcpServers, addMcpServer, reorderMcpServers } = useMcpServers()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isAddModalVisible, setIsAddModalVisible] = useState(false)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false)
  const [modalType, setModalType] = useState<ImportMethod>('json')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [builtinOnly, setBuiltinOnly] = useState(false)

  const [searchText, setSearchText] = useState('')
  // Keep typing responsive: the list re-filters on the deferred value.
  const deferredSearchText = useDeferredValue(searchText)

  const filteredMcpServers = useMemo(() => {
    const keywords = deferredSearchText.toLowerCase().split(/\s+/).filter(Boolean)

    return mcpServers.filter((server) => {
      if (statusFilter === 'enabled' && !server.isActive) return false
      if (statusFilter === 'disabled' && server.isActive) return false
      if (typeFilter !== 'all' && server.type !== typeFilter) return false
      if (builtinOnly && server.installSource !== 'builtin') return false

      if (keywords.length === 0) return true

      const searchTarget = `${server.name} ${server.description} ${server.tags?.join(' ')} ${server.provider ?? ''}`
      return matchKeywordsInString(keywords, searchTarget)
    })
  }, [builtinOnly, deferredSearchText, mcpServers, statusFilter, typeFilter])

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

  const handleQuickCreate = useCallback(
    async (dto: CreateMcpServerDto) => {
      const newServer = await addMcpServer(dto)
      void navigate({ to: `/settings/mcp/settings/${newServer.id}` })
      toast.success(t('settings.mcp.addSuccess'))
    },
    [addMcpServer, navigate, t]
  )

  const handleAddServerSuccess = useCallback(
    async (dto: CreateMcpServerDto): Promise<McpServer> => {
      const created = await addMcpServer(dto)
      setIsAddModalVisible(false)
      toast.success(t('settings.mcp.addSuccess'))
      return created
    },
    [addMcpServer, t]
  )

  const handleManualAdd = useCallback(() => {
    setIsAddMenuOpen(false)
    setIsQuickCreateOpen(true)
  }, [])

  const handleImport = useCallback((importMethod: ImportMethod) => {
    setIsAddMenuOpen(false)
    setModalType(importMethod)
    setIsAddModalVisible(true)
  }, [])

  return (
    <div className="flex h-[calc(100vh-var(--navbar-height))] w-full min-w-0 flex-1 flex-col gap-2 overflow-hidden px-6 py-4 pt-3">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <SettingTitle>
          <div className="flex min-w-0 items-center gap-2">
            <span>{t('settings.mcp.allServers')}</span>
            <span className="font-normal text-muted-foreground text-sm tabular-nums">
              {activeServerCount}/{mcpServers.length}
            </span>
          </div>
          <Popover open={isAddMenuOpen} onOpenChange={setIsAddMenuOpen}>
            <PopoverTrigger asChild>
              <Button type="button">
                <Plus size={16} />
                {t('common.add')}
                <ChevronDown size={14} />
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
        </SettingTitle>
        <SettingDescription>{t('settings.mcp.pageDescription')}</SettingDescription>
        <SettingDivider />

        <div className="flex w-full flex-wrap items-center gap-2 py-1">
          <div className="min-w-56 flex-1">
            <SearchInput
              aria-label={t('settings.mcp.search.tooltip')}
              placeholder={t('settings.mcp.search.placeholder')}
              value={searchText}
              onChange={(event) => setSearchText(event.currentTarget.value)}
              onClear={() => setSearchText('')}
              clearLabel={t('common.clear')}
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger aria-label={t('settings.mcp.filter.status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
            <SelectTrigger aria-label={t('settings.mcp.filter.type')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <label className="flex shrink-0 items-center gap-2 text-foreground-muted text-sm">
            {t('settings.mcp.filter.builtinOnly')}
            <Switch checked={builtinOnly} onCheckedChange={setBuiltinOnly} />
          </label>
          <EnvironmentDependencies mini />
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

      <QuickCreateMcpServerDialog
        open={isQuickCreateOpen}
        onOpenChange={setIsQuickCreateOpen}
        existingServers={mcpServers}
        onCreate={handleQuickCreate}
      />

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
