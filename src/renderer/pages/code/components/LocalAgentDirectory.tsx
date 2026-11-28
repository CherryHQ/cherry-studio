import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  GripVertical,
  Info,
  Loader2,
  MessageSquare,
  MoreVertical,
  Plus,
  PlugZap,
  RefreshCw,
  Settings2,
  SquareTerminal,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { gt, valid } from 'semver'

import {
  Badge,
  ReorderableList,
  Button,
  ScrollArea,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Tooltip,
  Switch
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { CommandContextMenu, type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import {} from '@renderer/components/icons/CliIcon'
import { LocalAgentIcon } from '@renderer/components/icons/LocalAgentIcon'
import { AgentUpgradeControl } from '@renderer/components/localAgent/AgentUpgradeControl'
import { LocalAgentModelList } from '@renderer/components/localAgent/LocalAgentModelList'
import { modelSettingsDetailClasses } from '@renderer/components/modelSettingsStyles'
import { useDataChange, useInvalidateCache, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useLocalAgentModelCatalog } from '@renderer/hooks/agent/useLocalAgentModelCatalog'
import { useLocalAgentModelSelection } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import { useLocalAgentVersion } from '@renderer/hooks/agent/useLocalAgentVersion'
import { useCloseConversationTabs, useCurrentTabId, useOptionalTabsContext } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { createAgentAndRefresh } from '@renderer/services/createAgent'
import { loggerService } from '@renderer/services/LoggerService'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { codeCliForLocalAgent } from '@renderer/utils/agent/codeCliForLocalAgent'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import { resolveAgentEntrySessionIdForAgent } from '@renderer/utils/conversationEntry'
import { findConversationTab } from '@renderer/utils/conversationNavigation'
import { formatErrorMessage } from '@renderer/utils/error'
import { getSidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import {
  getLocalAgentProtocol,
  LOCAL_AGENT_PRESETS,
  LocalAgentConfigurationSchema,
  LocalAgentLaunchSettingsSchema,
  type LocalAgentAccount,
  type LocalAgentConfiguration,
  type LocalAgentCheckResult,
  type LocalAgentDetection,
  type LocalAgentInstallResult,
  type LocalAgentUninstallResult,
  type LocalAgentPreset
} from '@shared/ai/localAgent'
import { AGENTS_MAX_LIMIT, type AgentEntity } from '@shared/data/api/schemas/agents'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import type { CodeCli } from '@shared/types/codeCli'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { LOCAL_AGENT_WEB_UI_IDS } from '@shared/types/managedTool'

import { LocalAgentAdvancedSettings } from './LocalAgentAdvancedSettings'
import { LocalAgentLogin } from './LocalAgentLogin'
import { LocalAgentTerminalDialog } from './LocalAgentTerminalDialog'
import { LocalAgentWebUiActions } from './LocalAgentWebUiActions'

const installErrorKeys = {
  registry: 'local_agents.install_error.registry',
  unsupported: 'local_agents.install_error.unsupported',
  missing_runtime: 'local_agents.install_error.missing_runtime',
  managed_runtime: 'local_agents.install_error.managed_runtime',
  failed: 'local_agents.install_error.failed',
  not_detected: 'local_agents.install_error.not_detected',
  stopping: 'local_agents.install_error.stopping'
} as const

const uninstallErrorKeys = {
  busy: 'local_agents.uninstall_error.busy',
  changed: 'local_agents.uninstall_error.changed',
  failed: 'local_agents.uninstall_error.failed',
  partial: 'local_agents.uninstall_error.partial',
  unsupported: 'local_agents.uninstall_error.unsupported'
} as const satisfies Record<Extract<LocalAgentUninstallResult, { ok: false }>['reason'], string>

const DEFAULT_AGENT_ORDER = new Map(
  [
    'claude',
    'codex',
    'cursor',
    'opencode',
    'copilot',
    'openclaw',
    'deepseek-harness',
    'pi-acp',
    'hermes',
    'kimi',
    'qwen',
    'cline',
    'kilo',
    'omp',
    'minimax',
    'antigravity-acp',
    'codebuddy-code',
    'qoder',
    'trae',
    'goose',
    'kiro',
    'mistral-vibe',
    'factory-droid',
    'auggie',
    'junie',
    'devin',
    'grok-build',
    'amp-acp',
    'deepagents',
    'cortex-code',
    'poolside',
    'snow',
    'zcode',
    'glm-acp-agent'
  ].map((id, index) => [id, index])
)

const LOCAL_AGENTS_FEEDBACK_ISSUE_URL = 'https://github.com/CherryHQ/cherry-studio/issues/24976'

const logger = loggerService.withContext('LocalAgentDirectory')

function presetDisplayName(preset: LocalAgentPreset, savedName?: string) {
  if ((preset.id === 'qoder' || preset.id === 'qoder-global') && (savedName === 'Qoder' || savedName === 'Qoder CN'))
    return preset.name
  return savedName ?? preset.name
}

function missingChatExecutable(detection?: LocalAgentDetection, config?: LocalAgentConfiguration) {
  if (config?.executableOverride || Object.keys(config?.env ?? {}).some((key) => key.toUpperCase() === 'PATH'))
    return undefined
  return detection?.missingChatExecutable
}

export function LocalAgentDirectory({
  renderCliConfig,
  renderDetails = (props) => <LocalAgentDetails key={props.preset?.id ?? props.agent?.id ?? 'custom-new'} {...props} />,
  getRowMenuItems
}: {
  getRowMenuItems?: (id: string, tool: CodeCli | undefined, name: string) => readonly CommandContextMenuExtraItem[]
  renderCliConfig?: (tool: string) => ReactNode
  renderDetails?: (props: ComponentProps<typeof LocalAgentDetails>) => ReactNode
}) {
  const { t } = useTranslation()
  const closeConversationTabs = useCloseConversationTabs()
  const [agentOrder, setAgentOrder] = usePreference('feature.code_cli.agent_order')
  const { agents, refetch } = useAgents({ includeDisabledLocal: true })
  const { data: archivedAgents, refetch: refetchArchivedAgents } = useQuery('/agents', {
    query: { inTrash: true, limit: AGENTS_MAX_LIMIT }
  })
  useDataChange('/agents', () => void refetchArchivedAgents())
  const [{ detections, confirmed }, setInventory] = useState(() => ({
    detections: new Map<string, LocalAgentDetection>(),
    confirmed: new Set<string>()
  }))
  const [detecting, setDetecting] = useState(false)
  const [query, setQuery] = useState('')
  const search: { id?: string; tool?: CodeCli } = useSearch({ strict: false })
  const navigate = useNavigate()
  const requestedId =
    (search.id === 'cli:deepseek-harness' || search.id === 'cli:openclaw' ? search.id.slice(4) : search.id) ??
    (search.tool &&
      (LOCAL_AGENT_PRESETS.find((preset) => codeCliForLocalAgent(preset.id) === search.tool)?.id ??
        `cli:${search.tool}`))
  const [selected, setSelected] = useState(requestedId ?? 'claude')
  const [pendingSelection, setPendingSelection] = useState<string>()
  const [openMenuId, setOpenMenuId] = useState<string>()
  const archivingAgent = useRef(false)
  const [installingAgents, setInstallingAgents] = useState<Map<string, string | undefined>>(() => new Map())
  const installAgent = useCallback(async (presetId: string, targetVersion?: string, systemOnly?: boolean) => {
    setInstallingAgents((current) => new Map(current).set(presetId, targetVersion))
    try {
      return await ipcApi.request('ai.local_agents.install', { presetId, targetVersion, systemOnly })
    } finally {
      setInstallingAgents((current) => {
        const next = new Map(current)
        next.delete(presetId)
        return next
      })
    }
  }, [])
  const navigateToSelection = useCallback(() => {
    if (pendingSelection) {
      setSelected(pendingSelection)
      void navigate({ to: '/settings/local-agents', search: { id: pendingSelection }, replace: true })
    }
    setPendingSelection(undefined)
  }, [navigate, pendingSelection])
  const cancelNavigation = useCallback(() => {
    setPendingSelection(undefined)
    void navigate({ to: '/settings/local-agents', search: { id: selected }, replace: true })
  }, [navigate, selected])
  const detectionRequest = useRef(0)
  const refresh = useCallback(async (manual = false) => {
    const request = ++detectionRequest.current
    setDetecting(true)
    try {
      const localDetections = await ipcApi.request('ai.local_agents.detect', {})
      if (request !== detectionRequest.current) return
      setInventory(({ detections }) => {
        const next = new Map(detections)
        const confirmed = new Set<string>()
        for (const detection of localDetections) {
          if (!detection.uncertain) confirmed.add(detection.presetId)
          if (
            !detection.uncertain ||
            (detection.path && !detection.missingChatExecutable) ||
            !next.has(detection.presetId)
          )
            next.set(detection.presetId, detection)
        }
        return { detections: next, confirmed }
      })
    } catch (error) {
      logger.warn('Failed to refresh local agent installations', error as Error)
      if (request === detectionRequest.current) {
        setInventory(({ detections }) => ({ detections, confirmed: new Set<string>() }))
        if (manual) toast.error(String(error))
      }
    } finally {
      if (request === detectionRequest.current) setDetecting(false)
    }
  }, [])
  const invalidateDetections = useCallback(() => {
    detectionRequest.current++
  }, [])
  useEffect(() => {
    void refresh()
    return invalidateDetections
  }, [refresh, invalidateDetections])
  useIpcOn('binary.availability_changed', () => void refresh())
  useIpcOn('ai.claude_code.binary.changed', ({ phase }) => {
    if (phase === 'ready') void refresh()
  })
  const localAgents = [
    ...agents,
    ...(archivedAgents?.items ?? []).filter((a) => a.deletedAt && !agents.some((agent) => agent.id === a.id))
  ].filter((a) => a.type === 'local')
  const getPriority = (entry: { id: string; agent?: AgentEntity; preset?: LocalAgentPreset }) =>
    !entry.agent?.deletedAt && entry.agent?.localRuntime?.enabled
      ? 2
      : Number(
          entry.preset?.protocol === 'cursor' ||
            !!detections.get(entry.id)?.path ||
            !!entry.agent?.localRuntime?.executableOverride
        )
  const orderIndex = new Map(
    agentOrder.map((id, index) => [id === 'cli:deepseek-harness' || id === 'cli:openclaw' ? id.slice(4) : id, index])
  )
  const entries = [
    ...LOCAL_AGENT_PRESETS.filter((preset) => !preset.retired).map((preset) => {
      const agent = localAgents.find((a) => a.localRuntime?.presetId === preset.id)
      return { id: preset.id, name: presetDisplayName(preset, agent?.name), preset, agent }
    }),
    ...localAgents
      .filter((a) => !a.localRuntime?.presetId)
      .map((agent) => ({ id: agent.id, name: agent.name, preset: undefined, agent }))
  ].sort(
    (a, b) =>
      getPriority(b) - getPriority(a) ||
      (orderIndex.get(a.id) ?? agentOrder.length) - (orderIndex.get(b.id) ?? agentOrder.length) ||
      (DEFAULT_AGENT_ORDER.get(a.id) ?? DEFAULT_AGENT_ORDER.size) -
        (DEFAULT_AGENT_ORDER.get(b.id) ?? DEFAULT_AGENT_ORDER.size)
  )
  const listedEntries = entries.filter(({ preset, agent }) => preset || !agent?.deletedAt)
  const dragName = (id: string | number) => entries.find((entry) => entry.id === id)?.name ?? String(id)
  const entry = entries.find((e) => e.id === selected || e.agent?.id === selected)
  const cliTool = entry?.preset ? codeCliForLocalAgent(entry.preset.id) : undefined
  const syncRequestedSelection = useEffectEvent((id: string) => {
    if (id !== selected && id !== entry?.id && id !== entry?.agent?.id) setPendingSelection(id)
  })
  useEffect(() => {
    if (requestedId) syncRequestedSelection(requestedId)
  }, [requestedId])
  useEffect(() => {
    if (pendingSelection && entry?.id.startsWith('cli:')) navigateToSelection()
  }, [pendingSelection, entry?.id, navigateToSelection])

  const archiveAgent = async (agent: AgentEntity) => {
    if (archivingAgent.current) return
    archivingAgent.current = true
    try {
      const confirmed = await popup.confirm({
        title: t('local_agents.disable_archive.title', { name: agent.name }),
        okText: t('common.archive')
      })
      if (!confirmed) return
      const result = await ipcApi.request('ai.agent.delete', { agentId: agent.id, deleteSessions: true })
      if (!result.deleted) {
        toast.error(t('common.error'))
        return
      }
      closeConversationTabs('agents', result.deletedSessionIds ?? [])
      if (entry?.id === agent.id) {
        setSelected('claude')
        setPendingSelection(undefined)
        void navigate({ to: '/settings/local-agents', search: { id: 'claude' }, replace: true })
      }
      await Promise.allSettled([refetch(), refetchArchivedAgents()])
      toast.success(t('common.archived', { name: agent.name }))
    } catch (error) {
      toast.error(formatErrorMessage(error))
    } finally {
      archivingAgent.current = false
    }
  }

  return (
    <div data-ui="code.view" className="flex h-full min-h-0 w-full">
      <aside
        data-ui="code.navigation"
        className="flex h-full w-[248px] shrink-0 basis-[248px] flex-col border-r-[0.5px] border-border">
        <div className="px-2.5 pt-2.5">
          <InputGroup className="h-8 rounded-[10px] bg-background shadow-none">
            <InputGroupAddon className="pl-2.5">
              <Search className="lucide-custom size-3.5 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('common.search')}
              placeholder={t('common.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="px-1.5 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setQuery('')
                }
              }}
            />
            <InputGroupAddon align="inline-end" className="gap-0 pr-1">
              {query && (
                <Tooltip content={t('common.clear')}>
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={t('common.clear')}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setQuery('')}>
                    <X className="lucide-custom size-3 text-muted-foreground" />
                  </InputGroupButton>
                </Tooltip>
              )}
              <Tooltip content={t('local_agents.detect')}>
                <InputGroupButton
                  size="icon-xs"
                  aria-label={t('local_agents.detect')}
                  disabled={detecting}
                  onClick={() => void refresh(true)}>
                  <RefreshCw
                    className={cn('lucide-custom size-3.5 text-muted-foreground', detecting && 'animate-spin')}
                  />
                </InputGroupButton>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <ScrollArea className="min-h-0 flex-1" contentProps={{ className: 'space-y-2 px-2.5 pt-2 pb-2.5' }}>
          {[2, 1, 0].map((priority) => {
            const items = listedEntries.filter((entry) => getPriority(entry) === priority)
            const visibleItems = items.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase()))
            if (!visibleItems.length) return null
            return (
              <ReorderableList
                key={priority}
                items={items}
                visibleItems={visibleItems}
                getId={(entry) => entry.id}
                dragHandle
                disabled={!!query || detecting}
                gap="0.5rem"
                restrictions={{ scrollableAncestor: true }}
                accessibility={{
                  screenReaderInstructions: { draggable: t('local_agents.drag.instructions') },
                  announcements: {
                    onDragStart: ({ activeId }) => t('local_agents.drag.picked_up', { name: dragName(activeId) }),
                    onDragOver: ({ activeId, overId }) =>
                      overId !== null
                        ? t('local_agents.drag.over', {
                            name: dragName(activeId),
                            over: dragName(overId)
                          })
                        : undefined,
                    onDragEnd: ({ activeId }) => t('local_agents.drag.dropped', { name: dragName(activeId) }),
                    onDragCancel: ({ activeId }) => t('local_agents.drag.cancelled', { name: dragName(activeId) })
                  }
                }}
                onReorder={async (nextItems) => {
                  const groupIds = new Set(items.map((item) => item.id))
                  let nextIndex = 0
                  const reordered = entries.map((entry) => (groupIds.has(entry.id) ? nextItems[nextIndex++] : entry))
                  await setAgentOrder(reordered.map((entry) => entry.id))
                }}
                onReorderError={() => toast.error(t('common.error'))}
                renderItem={(e, _index, { dragging, dragHandleProps }) => {
                  const enabled = !e.agent?.deletedAt && e.agent?.localRuntime?.enabled
                  const detection = detections.get(e.id)
                  const executableOverride = e.agent?.localRuntime?.executableOverride
                  const sdk = e.preset?.protocol === 'cursor'
                  const unavailable =
                    !sdk &&
                    !!detection &&
                    (confirmed.has(e.id) || !!detection.incompatiblePath) &&
                    (!detection.path || !!missingChatExecutable(detection, e.agent?.localRuntime)) &&
                    !executableOverride
                  const status = unavailable
                    ? t(detection.incompatiblePath ? 'local_agents.incompatible' : 'local_agents.not_installed')
                    : enabled
                      ? t('local_agents.enabled')
                      : executableOverride
                        ? t('settings.provider.not_checked')
                        : sdk
                          ? t('settings.dependencies.source.bundled')
                          : detection?.path
                            ? t('local_agents.detected')
                            : confirmed.has(e.id)
                              ? t('local_agents.not_installed')
                              : t('settings.provider.not_checked')
                  const tool = e.preset
                    ? codeCliForLocalAgent(e.preset.id)
                    : CODE_CLI_TOOL_PRESETS.find((tool) => e.id === `cli:${tool.id}`)?.id
                  const menuItems = [...(getRowMenuItems?.(e.id, tool, e.name) ?? [])]
                  const agent = e.agent
                  if (!e.preset && agent && !agent.deletedAt) {
                    menuItems.push({
                      type: 'item',
                      id: `local-agent.delete.${agent.id}`,
                      label: t('common.delete'),
                      icon: <Trash2 size={14} />,
                      destructive: true,
                      onSelect: () => void archiveAgent(agent)
                    })
                  }
                  const hasMenu = menuItems.length > 0
                  const menuOpen = openMenuId === e.id
                  const row = (
                    <div className={cn('group/row relative', dragging && 'opacity-65')}>
                      <Button
                        variant="ghost"
                        className={cn(
                          'h-8 w-full justify-between gap-0 rounded-[10px] border border-transparent py-0 pr-2.5 pl-3 text-left font-normal text-foreground shadow-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:ring-0',
                          hasMenu && 'pr-8',
                          entry?.id === e.id && 'bg-muted font-medium'
                        )}
                        aria-pressed={entry?.id === e.id}
                        aria-label={e.id.startsWith('cli:') ? e.name : `${e.name} · ${status}`}
                        onClick={() => setPendingSelection(e.id)}>
                        <span className="flex min-w-0 flex-1 items-center gap-2.5">
                          <LocalAgentIcon
                            presetId={e.preset?.id}
                            cliId={e.id.startsWith('cli:') ? e.id.slice(4) : undefined}
                            size={26}
                            variant="card"
                          />
                          <span className="min-w-0 truncate text-sm leading-[1.35] text-foreground">{e.name}</span>
                        </span>
                        {unavailable ? (
                          <Tooltip content={status} asChild>
                            <span className="ml-1 max-w-[45%] shrink-0 truncate text-xs font-normal text-foreground-tertiary">
                              {status}
                            </span>
                          </Tooltip>
                        ) : (
                          enabled &&
                          !hasMenu && (
                            <span aria-hidden className="mr-0.5 ml-1 size-1.5 shrink-0 rounded-full bg-success" />
                          )
                        )}
                      </Button>
                      {dragHandleProps && (
                        <Button
                          ref={dragHandleProps.ref}
                          variant="ghost"
                          size="icon-sm"
                          data-dragging={dragging ? 'true' : undefined}
                          className="absolute top-0 left-[3px] h-8 w-2.5 cursor-grab rounded-none p-0 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-transparent focus-visible:bg-muted focus-visible:opacity-100 focus-visible:ring-0 data-[dragging=true]:opacity-100"
                          aria-label={t('local_agents.drag.handle', { name: e.name })}>
                          <GripVertical className="lucide-custom size-4 w-2.5 text-muted-foreground" />
                        </Button>
                      )}
                      {hasMenu && (
                        <div className="absolute top-1/2 right-[7px] size-5 -translate-y-1/2">
                          {enabled && !unavailable && !menuOpen && (
                            <span
                              aria-hidden
                              className="pointer-events-none absolute top-1/2 right-1.5 size-1.5 -translate-y-1/2 rounded-full bg-success transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0"
                            />
                          )}
                          <CommandPopupMenu
                            location="webcontents.context"
                            extraItems={menuItems}
                            open={menuOpen}
                            onOpenChange={(open) =>
                              setOpenMenuId((current) => (open ? e.id : current === e.id ? undefined : current))
                            }
                            align="end"
                            contentClassName="w-fit min-w-32 rounded-xl p-1.5">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${e.name} · ${t('common.more')}`}
                              aria-haspopup="menu"
                              aria-expanded={menuOpen}
                              className="size-5 rounded-md p-0 text-muted-foreground opacity-0 transition-[color,opacity,background-color] group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-accent/40 hover:text-foreground focus-visible:bg-accent/40 focus-visible:text-foreground focus-visible:opacity-100 focus-visible:ring-0 aria-expanded:opacity-100">
                              <MoreVertical className="size-3.5" />
                            </Button>
                          </CommandPopupMenu>
                        </div>
                      )}
                    </div>
                  )
                  return hasMenu ? (
                    <CommandContextMenu location="webcontents.context" extraItems={menuItems}>
                      {row}
                    </CommandContextMenu>
                  ) : (
                    row
                  )
                }}
              />
            )
          })}
          {!listedEntries.some((e) => e.name.toLowerCase().includes(query.toLowerCase())) && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('common.no_results')}</p>
          )}
        </ScrollArea>
        <div className="shrink-0 px-2.5 pb-2.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full gap-1.5 text-xs shadow-none"
            onClick={() => setPendingSelection('custom-new')}>
            <Plus className="size-3.5" />
            {t('local_agents.custom')}
          </Button>
        </div>
      </aside>
      <main data-ui="code.content" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {entry || selected === 'custom-new'
          ? renderDetails({
              installing: installingAgents.has(entry?.preset?.id ?? ''),
              upgradeTargetVersion: installingAgents.get(entry?.preset?.id ?? ''),
              onInstall: installAgent,
              cliConfigEntry: renderCliConfig?.(cliTool ?? entry?.preset?.id ?? ''),
              pendingSelection:
                pendingSelection &&
                pendingSelection !== selected &&
                pendingSelection !== entry?.id &&
                pendingSelection !== entry?.agent?.id
                  ? pendingSelection
                  : undefined,
              onNavigate: navigateToSelection,
              onCancelNavigation: cancelNavigation,
              preset: entry?.preset,
              agent: entry?.agent,
              detection: entry?.preset && detections.get(entry.preset.id),
              detectionStatus: entry?.preset
                ? detecting
                  ? 'loading'
                  : confirmed.has(entry.preset.id)
                    ? undefined
                    : 'unknown'
                : undefined,
              onRetryDetection: () => void refresh(true),
              onSaved: async (id, refreshInstallations = true) => {
                await Promise.all([refetch(), refetchArchivedAgents()])
                setPendingSelection(undefined)
                setSelected(id)
                void navigate({ to: '/settings/local-agents', search: { id }, replace: true })
                if (refreshInstallations) await refresh()
              }
            })
          : null}
      </main>
    </div>
  )
}

export function LocalAgentDetails({
  installing,
  upgradeTargetVersion,
  onInstall,
  cliConfigEntry,
  pendingSelection,
  onNavigate,
  onCancelNavigation,
  preset,
  agent,
  detection,
  detectionStatus,
  onRetryDetection,
  onSaved,
  modelList,
  renderActions,
  children
}: {
  installing: boolean
  upgradeTargetVersion?: string
  onInstall: (presetId: string, targetVersion?: string, systemOnly?: boolean) => Promise<LocalAgentInstallResult>
  cliConfigEntry?: ReactNode
  pendingSelection?: string
  onNavigate: () => void
  onCancelNavigation: () => void
  preset?: LocalAgentPreset
  agent?: AgentEntity
  detection?: LocalAgentDetection
  detectionStatus?: 'loading' | 'unknown'
  onRetryDetection?: () => void
  onSaved: (id: string, refreshInstallations?: boolean) => Promise<void>
  modelList?: Omit<ComponentProps<typeof LocalAgentModelList>, 'scrollElement' | 'presetId'>
  renderActions?: (config: LocalAgentConfiguration, disabled: boolean) => ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const invalidate = useInvalidateCache()
  const closeConversationTabs = useCloseConversationTabs()
  const tabs = useOptionalTabsContext()
  const currentTabId = useCurrentTabId()
  const archived = !!agent?.deletedAt
  const displayName = preset ? presetDisplayName(preset, agent?.name) : (agent?.name ?? t('local_agents.custom'))
  const initial: LocalAgentConfiguration = agent?.localRuntime
    ? {
        ...LocalAgentConfigurationSchema.strip().parse(agent.localRuntime),
        enabled: !archived && agent.localRuntime.enabled
      }
    : { presetId: preset?.id, enabled: false, args: [], env: {} }
  const [busyAction, setBusyAction] = useState<
    'save' | 'check' | 'toggle' | 'uninstall' | 'confirm-uninstall' | 'model' | 'terminal'
  >()
  const missing = missingChatExecutable(detection, initial)
  const protocol = getLocalAgentProtocol(initial.presetId)
  const sdk = protocol === 'cursor'
  const available = sdk || (!!(detection?.path || initial.executableOverride) && !missing)
  const incompatiblePath = initial.executableOverride ? undefined : detection?.incompatiblePath
  const detectedPath = detection?.path ?? incompatiblePath
  const {
    catalog,
    freshCatalog,
    loading: modelsLoading,
    refreshError: modelsRefreshError,
    refresh: refreshModels
  } = useLocalAgentModelCatalog(preset?.id ?? agent?.id ?? 'custom-new', initial, !modelList && available, agent)
  const modelSelection = useLocalAgentModelSelection(initial, catalog?.models ?? [])
  const version = useLocalAgentVersion(sdk || initial.executableOverride ? undefined : preset?.id, detectedPath)
  const currentVersion = valid(version?.current)
  const latestVersion = valid(version?.latest)
  const updateVersion =
    upgradeTargetVersion ??
    (currentVersion && latestVersion && gt(latestVersion, currentVersion) ? latestVersion : undefined)
  const [openingChat, setOpeningChat] = useState(false)
  const installationUnknown = Boolean(preset && !sdk && !initial.executableOverride && (!detection || detectionStatus))
  const busy = installing || busyAction !== undefined || openingChat
  const chatDisabledReason = busy
    ? t('local_agents.chat_busy')
    : !agent || !initial.enabled
      ? t('local_agents.chat_requires_enabled')
      : undefined
  const modelSavingClass =
    busyAction === 'model' ? '[&_button:disabled]:pointer-events-auto [&_button:disabled]:opacity-100' : undefined
  const [result, setResult] = useState<{ message?: string; ok: boolean; modelRefreshFailed?: boolean }>({ ok: false })
  const clearResult = () => setResult(({ ok }) => ({ ok }))
  const showError = (error: unknown) => setResult({ ok: false, message: String(error) })
  const [connection, setConnection] = useState<{ status: LocalAgentCheckResult['status']; peerVersion?: string }>()
  const [programHovered, setProgramHovered] = useState(false)
  const feedbackTimer = useRef({ connection, remaining: 4000 })
  useEffect(() => {
    if (feedbackTimer.current.connection !== connection) feedbackTimer.current = { connection, remaining: 4000 }
    if (connection?.status !== 'ready' || programHovered) return
    const started = Date.now()
    const timer = setTimeout(() => setConnection(undefined), feedbackTimer.current.remaining)
    return () => {
      clearTimeout(timer)
      feedbackTimer.current.remaining = Math.max(0, feedbackTimer.current.remaining - (Date.now() - started))
    }
  }, [connection, programHovered])
  const [editing, setEditing] = useState(!preset && !agent)
  const [terminalOpen, setTerminalOpen] = useState(false)
  useEffect(() => {
    if (pendingSelection && !editing && (!busy || installing)) onNavigate()
  }, [pendingSelection, editing, busy, installing, onNavigate])
  const openTerminal = async (options: { directory: string; terminal?: string }) => {
    if (busy) return false
    setBusyAction('terminal')
    try {
      if (preset?.terminalCli) {
        const detected = await ipcApi.request('ai.local_agents.detect', {})
        if (!detected.find((entry) => entry.presetId === preset.id)?.terminalPath) {
          if (
            !(await popup.confirm({
              title: `${preset.name} · ${t('code.terminal')}`,
              content: `${preset.terminalCli.executable}: ${t('code.not_installed')}`,
              okText: t('code.install')
            }))
          )
            return false
          const installed = await onInstall(preset.id)
          if (!installed.ok) {
            toast.error(
              [t(installErrorKeys[installed.reason], { manager: installed.manager ?? '' }), installed.detail]
                .filter(Boolean)
                .join('\n')
            )
            return false
          }
        }
      }
      const response = await ipcApi.request('ai.local_agents.open_terminal', {
        ...initial,
        ...options,
        ...(agent && { agentId: agent.id }),
        directory: AbsoluteFilePathSchema.parse(options.directory)
      })
      if (!response.success) toast.error(response.message ?? t('common.error'))
      return response.success
    } catch (error) {
      toast.error(String(error))
      return false
    } finally {
      setBusyAction(undefined)
    }
  }
  const terminalButton = preset?.terminalArgs && (
    <Tooltip content={t('local_agents.open_terminal')}>
      <Button
        variant="outline"
        size="sm"
        className="h-8 shrink-0 rounded-lg border-border-subtle text-xs shadow-none"
        aria-label={t('local_agents.open_terminal')}
        disabled={busy || (!available && !detection?.terminalPath)}
        onClick={() => setTerminalOpen(true)}>
        {busyAction === 'terminal' ? (
          <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <SquareTerminal className="lucide-custom size-3.5 text-muted-foreground" />
        )}
        {t('code.terminal')}
      </Button>
    </Tooltip>
  )
  const openEditor = () => {
    if (archived && preset) return
    setConnection(undefined)
    clearResult()
    setEditing(true)
  }
  const closeEditor = () => {
    setEditing(false)
    clearResult()
    if (pendingSelection) onNavigate()
  }
  const persistLocalRuntime = (
    localRuntime: Partial<LocalAgentConfiguration> & { account?: LocalAgentAccount },
    name?: string
  ) =>
    agent
      ? ipcApi.request('ai.local_agents.update_settings', {
          agentId: agent.id,
          name,
          settings: localRuntime
        })
      : createAgentAndRefresh(
          {
            type: 'local',
            name: name ?? preset?.name ?? '',
            model: null,
            localRuntime: { ...initial, ...localRuntime }
          },
          async () => {}
        )
  const goToChat = async () => {
    if (busy || !agent || !initial.enabled) return
    if (!tabs || !currentTabId) {
      openRoute('/app/agents', { agentId: agent.id })
      return
    }
    setOpeningChat(true)
    try {
      const sessionId = await resolveAgentEntrySessionIdForAgent(agent.id)
      const app = getSidebarApp('agents')!
      const url = sessionId
        ? app.conversationRoute!.urlForKey(sessionId)
        : `/app/agents?agentId=${encodeURIComponent(agent.id)}`
      const target =
        (sessionId && findConversationTab(tabs.tabs, { conversationType: 'agent', conversationId: sessionId })) ||
        tabs.tabs
          .filter((tab) => tab.type === 'route' && tabBelongsToApp(app, tab.url))
          .sort((a, b) => (b.lastAccessTime ?? 0) - (a.lastAccessTime ?? 0))[0]
      if (target) {
        if (target.url !== url) tabs.updateTab(target.id, { url, title: agent.name })
        tabs.closeTabs([currentTabId], target.id)
        tabs.setActiveTab(target.id)
      } else {
        tabs.updateTab(currentTabId, { url, title: agent.name })
      }
    } catch (error) {
      toast.error(String(error))
    } finally {
      setOpeningChat(false)
    }
  }
  const checkError = (response: LocalAgentCheckResult) =>
    response.status === 'not-installed'
      ? t('local_agents.install_required')
      : [
          response.status === 'authentication-required'
            ? t('local_agents.login_required')
            : response.status === 'incompatible'
              ? t('local_agents.incompatible')
              : t('common.error'),
          response.error
        ]
          .filter(Boolean)
          .join('\n')
  const loadModels = async () => {
    if (busy) return
    clearResult()
    try {
      await refreshModels()
    } catch (error) {
      setResult({ ok: false, message: String(error), modelRefreshFailed: true })
    }
  }
  const selectModel = async (nativeModel?: string) => {
    if (busy || archived) return false
    setBusyAction('model')
    clearResult()
    try {
      const target = agent ?? (await persistLocalRuntime(initial))
      const updated = target && (await modelSelection.select(target, nativeModel))
      if (updated) await onSaved(updated.id, false)
      return !!updated
    } catch (error) {
      showError(error)
      return false
    } finally {
      setBusyAction(undefined)
    }
  }
  const install = async (targetVersion?: string, systemOnly?: boolean) => {
    if (!preset || busy) return
    clearResult()
    try {
      const response = await onInstall(preset.id, targetVersion, systemOnly)
      if (response.ok) setConnection(undefined)
      setResult({
        ok: response.ok,
        message: response.ok
          ? `${t(targetVersion ? 'code.upgrade_success' : 'local_agents.install_success')}\n${response.path}`
          : [t(installErrorKeys[response.reason], { manager: response.manager ?? '' }), response.detail]
              .filter(Boolean)
              .join('\n')
      })
    } catch (error) {
      showError(error)
    }
  }
  const uninstall = async () => {
    if (!preset || !detection?.path || busy) return
    const expectedPath = detection.path
    setBusyAction('confirm-uninstall')
    try {
      const components = await ipcApi.request('ai.local_agents.uninstall_components', {
        presetId: preset.id,
        expectedPath
      })
      if (!components.length) throw new Error(t('local_agents.uninstall_error.changed'))
      if (
        !(await popup.confirm({
          title: t('local_agents.uninstall_title', { name: preset.name }),
          content: (
            <div className="space-y-3">
              <p>{t('local_agents.uninstall_confirm')}</p>
              {components.map(({ executable, path }) => (
                <p key={executable} className="break-all text-xs text-muted-foreground">
                  <span className="font-medium">{executable}</span> · {path}
                </p>
              ))}
            </div>
          ),
          okText: t('local_agents.uninstall'),
          okButtonProps: { danger: true }
        }))
      )
        return
      clearResult()
      setBusyAction('uninstall')
      const response = await ipcApi.request('ai.local_agents.uninstall', {
        presetId: preset.id,
        expectedPath,
        expectedComponents: components
      })
      setResult({
        ok: response.ok,
        message: response.ok
          ? t('local_agents.uninstall_success')
          : [
              t(uninstallErrorKeys[response.reason]),
              response.removed?.length &&
                t('local_agents.uninstall_removed', { components: response.removed.join(', ') }),
              response.remaining?.length &&
                t('local_agents.uninstall_remaining', { components: response.remaining.join(', ') }),
              response.detail
            ]
              .filter(Boolean)
              .join('\n')
      })
    } catch (error) {
      showError(error)
    } finally {
      setBusyAction(undefined)
    }
  }
  const check = async () => {
    if (busy) return
    setBusyAction('check')
    setConnection(undefined)
    clearResult()
    try {
      const response = await ipcApi.request('ai.local_agents.check', {
        ...initial,
        ...(agent && { agentId: agent.id })
      })
      setConnection({ status: response.status, peerVersion: response.protocolInfo?.agent?.version })
      setResult({ ok: response.ok, message: response.ok ? undefined : checkError(response) })
    } catch (error) {
      setConnection({ status: 'failed' })
      showError(error)
    } finally {
      setBusyAction(undefined)
    }
  }
  const save = async (localRuntime: Partial<LocalAgentConfiguration>, savedName: string, action: 'save' | 'toggle') => {
    if (busy) return false
    setBusyAction(action)
    clearResult()
    try {
      if (!savedName) throw new Error(t('local_agents.name_required'))
      const configuration = { ...initial, ...localRuntime }
      if (initial.enabled && !configuration.enabled && agent) {
        if (
          !(await popup.confirm({
            title: t('local_agents.disable_archive.title', { name: savedName }),
            content: t('local_agents.disable_archive.description'),
            okText: t('local_agents.disable_archive.confirm')
          }))
        )
          return false
        const response = await ipcApi.request('ai.agent.delete', { agentId: agent.id, deleteSessions: true })
        closeConversationTabs('agents', response.deletedSessionIds ?? [])
        const refreshResults = await Promise.allSettled([
          invalidate([
            '/agents',
            `/agents/${agent.id}`,
            '/agent-sessions',
            '/agent-workspaces',
            '/agent-channels',
            '/pins'
          ]),
          onSaved(agent.id, false)
        ])
        for (const result of refreshResults) {
          if (result.status === 'rejected')
            logger.warn('Failed to refresh archived Agent', { agentId: agent.id, error: result.reason })
        }
        try {
          const webUiId = LOCAL_AGENT_WEB_UI_IDS.find((id) => id === configuration.presetId)
          if (webUiId) await ipcApi.request('ai.local_agents.web_stop', { presetId: webUiId })
          else if (configuration.presetId === 'codebuddy-code') await ipcApi.request('ai.codebuddy_web.stop')
          else if (configuration.presetId === 'hermes') {
            const stopped = await ipcApi.request('hermes_dashboard.stop')
            if (!stopped.success) throw new Error(stopped.message)
          } else if (configuration.presetId === 'openclaw') {
            const stopped = await ipcApi.request('openclaw.stop_gateway')
            if (!stopped.success) throw new Error(stopped.message)
          } else if (configuration.presetId === 'deepseek-harness') {
            const stopped = await ipcApi.request('deepseek_harness.stop')
            if (!stopped.success) throw new Error(stopped.message)
          }
        } catch (error) {
          logger.warn('Failed to stop disabled Agent WebUI', { presetId: configuration.presetId, error })
          showError(t('code.web_ui.stop_failed'))
          return false
        }
        toast.success(t('common.archived', { name: savedName }))
        return true
      }
      if (configuration.enabled || (!preset && !agent)) {
        const response = await ipcApi.request('ai.local_agents.check', {
          ...configuration,
          ...(agent && { agentId: agent.id })
        })
        if (!response.ok) {
          setConnection({ status: response.status })
          showError(checkError(response))
          return false
        }
      }
      const restored =
        archived && configuration.enabled && agent
          ? await ipcApi.request('ai.agent.restore', {
              agentId: agent.id,
              ...(action === 'save'
                ? {
                    launchSettings: LocalAgentLaunchSettingsSchema.parse({
                      executableOverride: configuration.executableOverride,
                      args: configuration.args,
                      env: configuration.env
                    })
                  }
                : {})
            })
          : undefined
      const updated = restored?.localRuntime?.enabled ? restored : await persistLocalRuntime(localRuntime, savedName)
      if (updated) {
        await onSaved(updated.id)
        toast.success(t('common.saved'))
      }
      return !!updated
    } catch (error) {
      showError(formatErrorMessage(error))
      return false
    } finally {
      setBusyAction(undefined)
    }
  }
  const feedbackMessage = result.message
  const classifiedError = feedbackMessage ? classifyLocalAgentError(feedbackMessage) : undefined
  const executablePath = initial.executableOverride ?? detectedPath ?? preset?.executable ?? ''
  const pathCharacters = Array.from(executablePath)
  const pathMiddle = Math.ceil(pathCharacters.length / 2)
  const needsAuthentication = !result.ok && classifiedError?.kind === 'authentication'
  const feedback = feedbackMessage && (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-xs',
        result.ok
          ? 'border-success-border bg-success-subtle text-success-subtle-foreground'
          : needsAuthentication
            ? 'border-border-subtle bg-background-subtle text-muted-foreground'
            : 'border-error-border bg-error-subtle text-error-subtle-foreground'
      )}>
      {result.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <CircleAlert className="size-4 shrink-0" />}
      <p className="min-w-0 whitespace-pre-wrap break-words">
        {result.modelRefreshFailed && !needsAuthentication && (
          <span className="block">{t('settings.models.manage.sync_pull_failed')}</span>
        )}
        {classifiedError?.kind === 'authentication'
          ? t('local_agents.sign_in_required')
          : classifiedError?.kind === 'region'
            ? t('local_agents.auth_region_unavailable')
            : classifiedError?.message}
      </p>
      {!result.ok &&
        !initial.executableOverride &&
        detection?.source === 'mise' &&
        (connection?.status === 'incompatible' ||
          (connection?.status === 'failed' && classifiedError?.kind === 'unknown')) && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void install(undefined, true)}>
            {t('code.install')}
          </Button>
        )}
    </div>
  )
  const displayVersion = initial.executableOverride ? connection?.peerVersion : (version?.current ?? detection?.version)
  return (
    <>
      {preset?.terminalArgs && (
        <LocalAgentTerminalDialog
          open={terminalOpen}
          preset={preset}
          name={displayName}
          onClose={() => setTerminalOpen(false)}
          onLaunch={openTerminal}
        />
      )}
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', modelSavingClass)}>
        <div className={modelSettingsDetailClasses.headerPad}>
          <div className={cn(modelSettingsDetailClasses.headerContentMaxWidth, 'flex min-h-7 items-center gap-3')}>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <LocalAgentIcon presetId={preset?.id} size={26} variant="card" />
              <h1 className="truncate text-[15px] leading-tight font-semibold text-foreground">
                {preset ? (
                  <a className="text-inherit no-underline" href={preset.helpUrl} target="_blank" rel="noreferrer">
                    {displayName}
                  </a>
                ) : (
                  displayName
                )}
              </h1>
              <div className="flex min-w-0 items-center gap-1.5">
                {displayVersion && (
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {displayVersion.startsWith('v') ? displayVersion : `v${displayVersion}`}
                  </span>
                )}
                {updateVersion && (
                  <AgentUpgradeControl
                    latestVersion={updateVersion}
                    upgrading={upgradeTargetVersion !== undefined}
                    disabled={busy}
                    onUpgrade={
                      version?.canUpgrade || upgradeTargetVersion !== undefined
                        ? () => void install(version?.latest)
                        : undefined
                    }
                  />
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {cliConfigEntry}
                <Tooltip content={t('common.advanced_settings')} asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 rounded-lg text-foreground-tertiary hover:text-foreground"
                    aria-label={t('common.advanced_settings')}
                    disabled={busy || (archived && !!preset)}
                    onClick={openEditor}>
                    <Settings2 className="lucide-custom size-3.5 text-muted-foreground" />
                  </Button>
                </Tooltip>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {busyAction === 'toggle' && (
                <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
              )}
              <Switch
                aria-label={t('local_agents.enable')}
                checked={initial.enabled}
                disabled={busy || (!preset && !agent) || (!initial.enabled && !available)}
                onCheckedChange={(enabled) => void save({ enabled }, agent?.name ?? preset?.name ?? '', 'toggle')}
              />
            </div>
          </div>
        </div>
        <ScrollArea
          className="min-h-0 flex-1"
          contentProps={{ className: 'flex min-h-full flex-col gap-2.5 px-6 pt-1.5 pb-2.5' }}
          viewportProps={{ ref: setScrollElement }}>
          <div className={cn(modelSettingsDetailClasses.sectionStack, 'min-h-0 shrink-0')}>
            <div className="flex flex-wrap items-center gap-2">
              {(sdk || initial.executableOverride || detectedPath || preset?.executable) && (
                <InputGroup
                  aria-label={sdk ? undefined : t('local_agents.installation_location')}
                  onMouseEnter={() => setProgramHovered(true)}
                  onMouseLeave={() => setProgramHovered(false)}
                  className={cn(
                    'h-8 min-w-[min(100%,12rem)] flex-1 rounded-lg border-border-subtle bg-muted/30 shadow-none transition-colors motion-reduce:transition-none',
                    connection?.status === 'ready' && 'border-success-border bg-success-subtle',
                    connection?.status === 'authentication-required' && 'border-warning-border bg-warning-subtle',
                    connection &&
                      !['ready', 'authentication-required'].includes(connection.status) &&
                      'border-error-border bg-error-subtle'
                  )}>
                  {sdk ? (
                    <span className="min-w-0 flex-1 truncate px-2.5 font-mono text-xs">@cursor/sdk</span>
                  ) : (
                    <Tooltip content={executablePath} asChild>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={openEditor}
                        aria-label={t('local_agents.installation_location')}
                        className="h-full min-w-0 flex-1 justify-start rounded-lg px-2.5 text-left font-normal hover:bg-transparent">
                        <span dir="ltr" className="flex min-w-0 font-mono text-xs text-foreground">
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
                            {pathCharacters.slice(0, pathMiddle).join('')}
                          </span>
                          <span dir="rtl" className="min-w-0 overflow-hidden whitespace-pre">
                            <bdi dir="ltr">{pathCharacters.slice(pathMiddle).join('')}</bdi>
                          </span>
                        </span>
                      </Button>
                    </Tooltip>
                  )}
                  <InputGroupAddon align="inline-end" className="shrink-0 gap-1 py-0 pr-1">
                    <span
                      role="status"
                      aria-live="polite"
                      className="flex items-center gap-1 whitespace-nowrap text-xs">
                      {connection ? (
                        <span
                          className={cn(
                            'flex items-center gap-1',
                            connection.status === 'ready'
                              ? 'text-success-subtle-foreground'
                              : connection.status === 'authentication-required'
                                ? 'text-warning-subtle-foreground'
                                : 'text-error-subtle-foreground'
                          )}>
                          {connection.status === 'ready' ? (
                            <CheckCircle2 className="lucide-custom size-3" />
                          ) : (
                            <CircleAlert className="lucide-custom size-3" />
                          )}
                          {connection.status === 'ready'
                            ? t('agent.channels.connected')
                            : connection.status === 'authentication-required'
                              ? t('local_agents.login_required')
                              : t('local_agents.check_failed')}
                          {connection.status === 'ready' &&
                            connection.peerVersion &&
                            ` · ${/^\d/.test(connection.peerVersion) ? `v${connection.peerVersion}` : connection.peerVersion}`}
                        </span>
                      ) : (
                        <Badge variant="secondary" className="px-1.5 py-0 text-xs text-muted-foreground">
                          {initial.executableOverride
                            ? t('settings.provider.not_checked')
                            : installationUnknown && detectionStatus
                              ? t(detectionStatus === 'loading' ? 'common.loading' : 'common.unknown')
                              : missing
                                ? `${missing} · ${t('local_agents.not_installed')}`
                                : sdk
                                  ? t('settings.dependencies.source.bundled')
                                  : detection?.path
                                    ? t('local_agents.detected')
                                    : incompatiblePath
                                      ? t('local_agents.incompatible')
                                      : installationUnknown
                                        ? t('settings.provider.not_checked')
                                        : t('local_agents.not_installed')}
                        </Badge>
                      )}
                    </span>
                    {available && (
                      <Tooltip content={t('local_agents.check')}>
                        <InputGroupButton
                          size="icon-xs"
                          aria-label={t('local_agents.check')}
                          disabled={busy || (!preset && !agent)}
                          onClick={() => void check()}>
                          {busyAction === 'check' ? (
                            <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            <PlugZap className="lucide-custom size-3.5 text-muted-foreground" />
                          )}
                        </InputGroupButton>
                      </Tooltip>
                    )}
                  </InputGroupAddon>
                </InputGroup>
              )}
              <div className="flex flex-wrap items-center gap-2 empty:hidden">
                {installationUnknown && detectionStatus === 'unknown' && onRetryDetection && (
                  <Button type="button" variant="outline" size="sm" onClick={onRetryDetection}>
                    {t('common.retry')}
                  </Button>
                )}
                {!available && detection?.terminalPath && terminalButton}
                {available ? (
                  <>
                    {preset?.credentialScope !== 'provider' && (sdk || protocol === 'acp' || preset?.loginArgs) && (
                      <LocalAgentLogin
                        config={initial}
                        agent={agent}
                        authMethods={protocol === 'acp' ? (freshCatalog?.authMethods ?? catalog?.authMethods) : []}
                        modelsLoading={modelsLoading}
                        freshCatalog={freshCatalog}
                        authenticationError={modelsRefreshError ?? (freshCatalog ? undefined : result.message)}
                        onRefresh={refreshModels}
                        available={available}
                        disabled={busy || archived}
                        helpUrl={preset?.helpUrl}
                        onConfigureCredentials={preset?.credentialEnvironment?.length ? openEditor : undefined}
                        onTerminalLogin={
                          preset?.loginArgs
                            ? async (provider) => {
                                const response = await ipcApi.request('ai.local_agents.open_terminal', {
                                  ...initial,
                                  ...(agent && { agentId: agent.id }),
                                  login: provider ? { provider } : true
                                })
                                if (!response.success) throw new Error(response.message ?? t('common.error'))
                              }
                            : undefined
                        }
                        onAuthenticated={async (localRuntime, account) => {
                          setConnection(undefined)
                          clearResult()
                          if (agent) {
                            await onSaved(agent.id)
                            void loadModels()
                          } else if (account || JSON.stringify(localRuntime.env) !== JSON.stringify(initial.env)) {
                            const updated = await persistLocalRuntime({ env: localRuntime.env, account })
                            if (!updated) throw new Error(t('common.error'))
                            await onSaved(updated.id)
                          } else void loadModels()
                          toast.success(t('local_agents.signed_in'))
                        }}
                      />
                    )}
                    {renderActions?.(initial, busy)}
                    <LocalAgentWebUiActions config={initial} agentId={agent?.id} disabled={busy || !available} />
                    {terminalButton}
                    <Tooltip content={chatDisabledReason} asChild>
                      <span className="inline-flex" tabIndex={chatDisabledReason ? 0 : undefined}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 rounded-lg border-border-subtle text-xs shadow-none"
                          disabled={!!chatDisabledReason}
                          onClick={() => void goToChat()}>
                          <MessageSquare className="lucide-custom size-3.5 text-muted-foreground" />
                          {t('title.chat')}
                        </Button>
                      </span>
                    </Tooltip>
                  </>
                ) : incompatiblePath ? null : preset && !installationUnknown ? (
                  <Button
                    size="sm"
                    className="h-8 shrink-0 rounded-lg border border-transparent text-xs shadow-none"
                    disabled={busy}
                    onClick={() => void install()}>
                    {installing ? (
                      <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    {t(installing ? 'local_agents.installing' : 'code.install')}
                  </Button>
                ) : !agent ? (
                  <Button size="sm" onClick={openEditor}>
                    {t('common.settings')}
                  </Button>
                ) : null}
              </div>
            </div>
            {!editing && feedback}
            {modelList ? (
              <LocalAgentModelList
                {...modelList}
                presetId={preset?.id}
                scrollElement={scrollElement}
                disabled={busy || archived || modelList.disabled}
              />
            ) : (
              (preset || agent) && (
                <LocalAgentModelList
                  models={modelSelection.models}
                  followCliLabel={modelSelection.followCliLabel}
                  sourceRestrictions={modelSelection.sourceRestrictions}
                  presetId={preset?.id}
                  scrollElement={scrollElement}
                  value={modelSelection.value}
                  disabled={busy || archived}
                  loading={modelsLoading}
                  loaded={!!catalog}
                  loadDisabled={!available}
                  onLoad={loadModels}
                  onSelect={selectModel}
                />
              )
            )}
          </div>
          <footer
            className={cn(
              modelSettingsDetailClasses.contentMaxWidth,
              'mt-auto flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-muted/30 px-3.5 py-2 text-xs text-muted-foreground'
            )}>
            <div className="flex min-w-0 items-center gap-2">
              <Info className="lucide-custom size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">{t('local_agents.beta_banner')}</span>
            </div>
            <a
              href={LOCAL_AGENTS_FEEDBACK_ISSUE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 font-normal text-link underline-offset-2 hover:underline focus-visible:underline">
              {t('local_agents.beta_banner_link')}
              <ExternalLink className="lucide-custom size-3" aria-hidden />
            </a>
          </footer>
        </ScrollArea>
      </div>
      {children}
      {editing && (
        <LocalAgentAdvancedSettings
          config={initial}
          name={agent?.name ?? preset?.name ?? ''}
          preset={preset}
          detection={detection}
          hasAgent={!!agent}
          restoring={archived}
          busyAction={installing ? 'install' : busyAction}
          pendingSelection={pendingSelection}
          feedback={feedback}
          onClose={closeEditor}
          onCancelNavigation={onCancelNavigation}
          onChange={clearResult}
          onError={showError}
          onUninstall={uninstall}
          onSave={(localRuntime, name) =>
            save(archived ? { ...localRuntime, enabled: true } : localRuntime, name, 'save')
          }
        />
      )}
    </>
  )
}
