import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, Filter, Plus } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Sortable,
  useDndReorder
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useExitPresence } from '@renderer/hooks/useExitPresence'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { ipcApi } from '@renderer/ipc'
import EnvironmentDependencies from '@renderer/pages/settings/DependenciesSettings/EnvironmentDependencies'
import { toast } from '@renderer/services/toast'
import type { AppRouter } from '@renderer/types/router'
import { matchKeywordsInString } from '@renderer/utils/match'
import {
  DuplicateMcpServerNameError,
  isExportableMcpServer,
  serializeMcpServersForExport
} from '@renderer/utils/mcpTransfer'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { ProtocolMcpInstallRequest } from '@shared/data/types/mcpProtocolInstall'
import type { McpServer } from '@shared/data/types/mcpServer'
import { isBrowserMcpServer } from '@shared/utils/mcp'

import AddMcpServerModal from './AddMcpServerModal'
import McpProtocolInstallDialog from './McpProtocolInstallDialog'
import McpServerCard from './McpServerCard'
import QuickCreateMcpServerDialog from './QuickCreateMcpServerDialog'

const logger = loggerService.withContext('McpServersList')
const mcpServersRouteApi = getRouteApi('/settings/mcp/servers')

type ImportMethod = 'json' | 'dxt' | 'mcpb'
type McpServerFilter = 'all' | 'enabled' | 'disabled' | 'stdio' | 'sse' | 'streamableHttp' | 'builtin'
const FILTER_OPTIONS: { value: McpServerFilter; labelKey?: string; label?: string }[] = [
  { value: 'all', labelKey: 'models.all' },
  { value: 'enabled', labelKey: 'common.enabled' },
  { value: 'disabled', labelKey: 'common.disabled' },
  { value: 'stdio', label: 'STDIO' },
  { value: 'sse', label: 'SSE' },
  { value: 'streamableHttp', labelKey: 'settings.mcp.types.streamableHttp' },
  { value: 'builtin', labelKey: 'settings.mcp.builtinServers' }
]

const McpServersList: FC = () => {
  const { mcpServers, addMcpServer, reorderMcpServers, refetch } = useMcpServers()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = mcpServersRouteApi.useSearch<AppRouter>()
  const [isAddModalVisible, setIsAddModalVisible] = useState(false)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false)
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false)
  const [modalType, setModalType] = useState<ImportMethod>('json')
  const [filter, setFilter] = useState<McpServerFilter>('all')
  const [protocolInstallQueue, setProtocolInstallQueue] = useState<ProtocolMcpInstallRequest[]>([])
  const protocolInstallQueueRef = useRef<ProtocolMcpInstallRequest[]>([])
  const pendingAutoEnableServerIdRef = useRef<string | null>(null)
  const protocolInstallRequest = protocolInstallQueue[0]
  const [displayedProtocolRequestId, setDisplayedProtocolRequestId] = useState<string | null>(null)
  const displayedProtocolRequest = protocolInstallQueue.find(
    (request) => request.requestId === displayedProtocolRequestId
  )
  const protocolDialog = useExitPresence(displayedProtocolRequest ?? null)

  const [searchText, setSearchText] = useState('')
  // Keep typing responsive: the list re-filters on the deferred value.
  const deferredSearchText = useDeferredValue(searchText)

  const updateProtocolInstallQueue = useCallback(
    (update: (queue: ProtocolMcpInstallRequest[]) => ProtocolMcpInstallRequest[]) => {
      const nextQueue = update(protocolInstallQueueRef.current)
      protocolInstallQueueRef.current = nextQueue
      setProtocolInstallQueue(nextQueue)
      return nextQueue
    },
    []
  )

  useEffect(() => {
    void ipcApi.request('mcp.protocol_install.list_pending').then(
      (requests) => updateProtocolInstallQueue(() => requests),
      (error) => logger.error('Failed to list MCP protocol install requests', error as Error)
    )
  }, [search.protocolInstallRequestId, updateProtocolInstallQueue])

  const removeProtocolInstallRequest = useCallback(
    (requestId: string) => {
      return updateProtocolInstallQueue((queue) => queue.filter((request) => request.requestId !== requestId))
    },
    [updateProtocolInstallQueue]
  )

  const openProtocolServer = useCallback(
    (serverId: string) => {
      void navigate({
        to: '/settings/mcp/settings/$serverId',
        params: { serverId },
        search: { autoEnable: 'true' }
      })
    },
    [navigate]
  )

  useEffect(() => {
    if (protocolDialog.isPresent) return
    setDisplayedProtocolRequestId(protocolInstallRequest?.requestId ?? null)
    if (protocolInstallRequest || !pendingAutoEnableServerIdRef.current) return
    const serverId = pendingAutoEnableServerIdRef.current
    pendingAutoEnableServerIdRef.current = null
    openProtocolServer(serverId)
  }, [openProtocolServer, protocolDialog.isPresent, protocolInstallRequest])

  const handleProtocolInstallClose = useCallback(async () => {
    if (!displayedProtocolRequest) return

    try {
      await ipcApi.request('mcp.protocol_install.cancel', { requestId: displayedProtocolRequest.requestId })
    } catch (error) {
      logger.error('Failed to cancel MCP protocol install request', error as Error)
      return
    }

    removeProtocolInstallRequest(displayedProtocolRequest.requestId)
  }, [displayedProtocolRequest, removeProtocolInstallRequest])

  const filteredMcpServers = useMemo(() => {
    const keywords = deferredSearchText.toLowerCase().split(/\s+/).filter(Boolean)

    return mcpServers.filter((server) => {
      if (isBrowserMcpServer(server)) return false
      if (filter === 'enabled' && !server.isActive) return false
      if (filter === 'disabled' && server.isActive) return false
      if (filter === 'stdio' && server.type !== 'stdio') return false
      if (filter === 'sse' && server.type !== 'sse') return false
      if (filter === 'streamableHttp' && server.type !== 'streamableHttp') return false
      if (filter === 'builtin' && server.installSource !== 'builtin') return false

      if (keywords.length === 0) return true

      const searchTarget = `${server.name} ${server.description} ${server.tags?.join(' ')} ${server.provider ?? ''}`
      return matchKeywordsInString(keywords, searchTarget)
    })
  }, [deferredSearchText, filter, mcpServers])

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
    async (dtos: CreateMcpServerDto[]): Promise<McpServer[]> => {
      const created: McpServer[] = []
      for (const dto of dtos) {
        created.push(await addMcpServer(dto))
      }
      setIsAddModalVisible(false)
      toast.success(t('settings.mcp.addSuccess'))
      return created
    },
    [addMcpServer, t]
  )

  const handleProtocolInstall = useCallback(async () => {
    if (!displayedProtocolRequest) return

    let createdServers: McpServer[]
    try {
      createdServers = await ipcApi.request('mcp.protocol_install.install', {
        requestId: displayedProtocolRequest.requestId
      })
    } catch (error) {
      logger.error('Failed to install MCP servers from protocol', error as Error)
      toast.error(t('settings.mcp.addError'))
      return
    }

    const lastCreatedServer = createdServers.at(-1)
    if (!lastCreatedServer) return

    void refetch().catch((error) =>
      logger.error('Failed to refresh MCP servers after protocol install', error as Error)
    )
    pendingAutoEnableServerIdRef.current = lastCreatedServer.id
    removeProtocolInstallRequest(displayedProtocolRequest.requestId)
    toast.success(t('settings.mcp.addSuccess'))
  }, [displayedProtocolRequest, refetch, removeProtocolInstallRequest, t])

  const handleManualAdd = useCallback(() => {
    setIsAddMenuOpen(false)
    setIsQuickCreateOpen(true)
  }, [])

  const handleImport = useCallback((importMethod: ImportMethod) => {
    setIsAddMenuOpen(false)
    setModalType(importMethod)
    setIsAddModalVisible(true)
  }, [])

  const handleExport = useCallback(async () => {
    setIsAddMenuOpen(false)
    if (exporting) return
    setExporting(true)
    try {
      const content = serializeMcpServersForExport(mcpServers)
      await window.api.file.save('mcp-servers.json', new TextEncoder().encode(content), {
        filters: [{ name: t('assistants.presets.import.file_filter'), extensions: ['json'] }]
      })
    } catch (error) {
      toast.error(
        error instanceof DuplicateMcpServerNameError
          ? t('settings.mcp.exportDuplicateName', { name: error.serverName })
          : t('settings.mcp.exportFailed')
      )
    } finally {
      setExporting(false)
    }
  }, [exporting, mcpServers, t])

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 overflow-hidden px-6 pt-4 pb-6">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <div className="mb-1 flex min-w-0 shrink-0 items-center justify-between gap-4 border-b border-border-subtle pb-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <SettingTitle className="shrink-0">{t('settings.mcp.shortTitle')}</SettingTitle>
              <Popover open={isFilterMenuOpen} onOpenChange={setIsFilterMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('settings.mcp.filter.label')}
                    className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-accent">
                    <Filter
                      size={14}
                      color={filter === 'all' ? 'var(--muted-foreground)' : undefined}
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
                value={searchText}
                placeholder={t('settings.mcp.search.placeholder')}
                tooltip={t('settings.mcp.search.tooltip')}
                maxWidth={220}
                collapsedSize={30}
                style={{ borderRadius: 8 }}
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <EnvironmentDependencies mini />
            <DropdownMenu open={isAddMenuOpen} onOpenChange={setIsAddMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="default" size="sm" className="shrink-0">
                  <Plus size={12} className="lucide-custom" />
                  <span>{t('common.add')}</span>
                  <ChevronDown size={12} className="text-primary-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onSelect={handleManualAdd}>{t('settings.mcp.addServer.create')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleImport('json')}>
                  {t('settings.mcp.addServer.importFrom.json')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleImport('dxt')}>
                  {t('settings.mcp.addServer.importFrom.dxt')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleImport('mcpb')}>
                  {t('settings.mcp.addServer.importFrom.mcpb')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void handleExport()}
                  disabled={exporting || !mcpServers.some(isExportableMcpServer)}>
                  {t('settings.mcp.exportAsJson')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
              <ScrollArea viewportProps={{ ref: scrollRef }} className="min-h-0 flex-1">
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
              </ScrollArea>
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

      {protocolDialog.value && (
        <McpProtocolInstallDialog
          key={protocolDialog.value.requestId}
          open={displayedProtocolRequest !== undefined}
          servers={protocolDialog.value.servers}
          onClose={handleProtocolInstallClose}
          onInstall={handleProtocolInstall}
        />
      )}
    </div>
  )
}

export default McpServersList
