import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  ArrowUpCircle,
  CheckCircle2,
  Download,
  CircleAlert,
  Loader2,
  MessageSquare,
  Plus,
  PlugZap,
  RefreshCw,
  Settings2,
  SquareTerminal,
  Search,
  X
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  ReorderableList,
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Tooltip,
  Switch
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { CLI_TOOLS } from '@renderer/components/icons/CliIcon'
import { LocalAgentIcon } from '@renderer/components/icons/LocalAgentIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents, useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useLocalAgentModelCatalog } from '@renderer/hooks/agent/useLocalAgentModelCatalog'
import { useLocalAgentModelSelection } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import { useLocalAgentVersion } from '@renderer/hooks/agent/useLocalAgentVersion'
import { useCurrentTabId, useOptionalTabsContext } from '@renderer/hooks/tab'
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
import { getSidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentConfiguration,
  type LocalAgentCheckResult,
  type LocalAgentDetection,
  type LocalAgentPreset
} from '@shared/ai/localAgent'
import { LOCAL_AGENT_MODEL_CONFIG } from '@shared/ai/localAgentModel'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import type { CodeCli } from '@shared/types/codeCli'

import { AgentServiceCard } from './AgentServiceCard'
import { LocalAgentAdvancedSettings } from './LocalAgentAdvancedSettings'
import { LocalAgentModelList } from './LocalAgentModelList'
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

const CLI_ONLY_TOOLS = CODE_CLI_TOOL_PRESETS.filter(
  (tool) => !LOCAL_AGENT_PRESETS.some((preset) => codeCliForLocalAgent(preset.id) === tool.id)
)

const DEFAULT_AGENT_ORDER = new Map(
  [
    'claude',
    'codex',
    'cursor',
    'opencode',
    'copilot',
    'cli:openclaw',
    'cli:deepseek-harness',
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
    'fast-agent',
    'cortex-code',
    'poolside',
    'stakpak',
    'vtcode',
    'snow',
    'zcode',
    'glm-acp-agent'
  ].map((id, index) => [id, index])
)

const logger = loggerService.withContext('LocalAgentDirectory')

export function LocalAgentDirectory({
  destination = '/settings/local-agents',
  renderCli,
  renderCliConfig,
  renderContextMenu
}: {
  destination?: '/app/code' | '/settings/local-agents'
  renderContextMenu?: (id: string, tool: CodeCli | undefined, name: string, row: ReactNode) => ReactNode
  renderCliConfig?: (tool: string) => ReactNode
  renderCli?: (tool: CodeCli) => ReactNode
}) {
  const { t } = useTranslation()
  const [agentOrder, setAgentOrder] = usePreference('feature.code_cli.agent_order')
  const { agents, refetch } = useAgents({ includeDisabledLocal: true })
  const [detections, setDetections] = useState<LocalAgentDetection[]>([])
  const [detecting, setDetecting] = useState(false)
  const [query, setQuery] = useState('')
  const search = useSearch({ strict: false }) as { id?: string; tool?: CodeCli }
  const navigate = useNavigate()
  const requestedId =
    search.id ??
    (search.tool &&
      (LOCAL_AGENT_PRESETS.find((preset) => codeCliForLocalAgent(preset.id) === search.tool)?.id ??
        `cli:${search.tool}`))
  const [selected, setSelected] = useState(requestedId ?? 'claude')
  const [pendingSelection, setPendingSelection] = useState<string>()
  useEffect(() => {
    if (requestedId) setPendingSelection(requestedId)
  }, [requestedId])
  const navigateToSelection = useCallback(() => {
    if (pendingSelection) {
      setSelected(pendingSelection)
      void navigate({ to: destination, search: { id: pendingSelection }, replace: true })
    }
    setPendingSelection(undefined)
  }, [navigate, pendingSelection, destination])
  const cancelNavigation = useCallback(() => {
    setPendingSelection(undefined)
    void navigate({ to: destination, search: { id: selected }, replace: true })
  }, [navigate, selected, destination])
  const includeCli = !!renderCli
  const refresh = useCallback(
    async (manual = false) => {
      setDetecting(true)
      try {
        const [localDetections, cliSnapshots] = await Promise.all([
          ipcApi.request('ai.local_agents.detect', {}),
          includeCli
            ? ipcApi.request(
                'binary.get_tool_snapshots',
                CLI_ONLY_TOOLS.map((tool) => tool.executable)
              )
            : undefined
        ])
        setDetections([
          ...localDetections,
          ...(cliSnapshots
            ? CLI_ONLY_TOOLS.map((tool) => ({
                presetId: `cli:${tool.id}`,
                ...(cliSnapshots[tool.executable]?.availability ?? { source: 'none' })
              }))
            : [])
        ])
      } catch (error) {
        logger.warn('Failed to refresh local agent installations', error as Error)
        if (manual) toast.error(String(error))
      } finally {
        setDetecting(false)
      }
    },
    [includeCli]
  )
  useEffect(() => {
    void refresh()
  }, [refresh])
  useIpcOn('binary.availability_changed', () => void refresh())
  const localAgents = agents.filter((a) => a.type === 'local')
  const installedIds = new Set(detections.filter((detection) => detection.path).map((detection) => detection.presetId))
  const getPriority = (entry: { id: string; agent?: AgentEntity }) =>
    entry.agent?.configuration?.localRuntime?.enabled
      ? 2
      : Number(installedIds.has(entry.id) || !!entry.agent?.configuration?.localRuntime?.executableOverride)
  const orderIndex = new Map(agentOrder.map((id, index) => [id, index]))
  const entries = [
    ...LOCAL_AGENT_PRESETS.map((preset) => ({
      id: preset.id,
      name: localAgents.find((a) => a.configuration?.localRuntime?.presetId === preset.id)?.name ?? preset.name,
      preset,
      agent: localAgents.find((a) => a.configuration?.localRuntime?.presetId === preset.id)
    })),
    ...localAgents
      .filter((a) => !a.configuration?.localRuntime?.presetId)
      .map((agent) => ({ id: agent.id, name: agent.name, preset: undefined, agent })),
    ...(renderCli
      ? CLI_ONLY_TOOLS.map((tool) => ({
          id: `cli:${tool.id}`,
          name: t(CLI_TOOLS.find((entry) => entry.value === tool.id)!.label),
          preset: undefined,
          agent: undefined
        }))
      : [])
  ].sort(
    (a, b) =>
      getPriority(b) - getPriority(a) ||
      (orderIndex.get(a.id) ?? agentOrder.length) - (orderIndex.get(b.id) ?? agentOrder.length) ||
      (DEFAULT_AGENT_ORDER.get(a.id) ?? DEFAULT_AGENT_ORDER.size) -
        (DEFAULT_AGENT_ORDER.get(b.id) ?? DEFAULT_AGENT_ORDER.size)
  )
  const entry = entries.find((e) => e.id === selected || e.agent?.id === selected)
  const cliTool = entry?.preset
    ? codeCliForLocalAgent(entry.preset.id)
    : CODE_CLI_TOOL_PRESETS.find((tool) => entry?.id === `cli:${tool.id}`)?.id
  useEffect(() => {
    if (pendingSelection && entry?.id.startsWith('cli:')) navigateToSelection()
  }, [pendingSelection, entry?.id, navigateToSelection])
  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="flex h-full w-[248px] shrink-0 basis-[248px] flex-col border-r-[0.5px] border-border">
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
        <Scrollbar className="min-h-0 flex-1 space-y-2 px-2.5 pt-2 pb-2.5">
          {[2, 1, 0].map((priority) => {
            const items = entries.filter((entry) => getPriority(entry) === priority)
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
                onReorder={async (nextItems) => {
                  const reordered = [...entries]
                  reordered.splice(
                    entries.findIndex((entry) => getPriority(entry) === priority),
                    nextItems.length,
                    ...nextItems
                  )
                  await setAgentOrder(reordered.map((entry) => entry.id))
                }}
                onReorderError={() => toast.error(t('common.error'))}
                renderItem={(e, _index, { dragHandleProps }) => {
                  const enabled = e.agent?.configuration?.localRuntime?.enabled
                  const detection = detections.find((d) => d.presetId === e.id)
                  const executableOverride = e.agent?.configuration?.localRuntime?.executableOverride
                  const notInstalled = !!detection && !detection.path && !executableOverride
                  const status = notInstalled
                    ? t('local_agents.not_installed')
                    : enabled
                      ? t('local_agents.enabled')
                      : executableOverride
                        ? t('settings.provider.not_checked')
                        : detection?.path
                          ? t('local_agents.detected')
                          : t('local_agents.not_installed')
                  const row = (
                    <Button
                      key={e.id}
                      ref={dragHandleProps?.ref}
                      {...dragHandleProps?.attributes}
                      {...dragHandleProps?.listeners}
                      variant="ghost"
                      className={cn(
                        'h-8 w-full justify-start gap-2.5 rounded-[10px] border border-transparent py-0 pr-2.5 pl-3 text-left font-normal shadow-none hover:bg-muted',
                        entry?.id === e.id && 'bg-muted font-medium'
                      )}
                      aria-pressed={entry?.id === e.id}
                      aria-label={e.id.startsWith('cli:') ? e.name : `${e.name} · ${status}`}
                      onClick={() => setPendingSelection(e.id)}>
                      <LocalAgentIcon
                        presetId={e.preset?.id}
                        cliId={e.id.startsWith('cli:') ? e.id.slice(4) : undefined}
                        size={26}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm leading-[1.35]">{e.name}</span>
                      {notInstalled ? (
                        <span className="shrink-0 text-xs font-normal text-foreground-tertiary">
                          {t('local_agents.not_installed')}
                        </span>
                      ) : (
                        enabled && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
                      )}
                    </Button>
                  )
                  const tool = e.preset
                    ? codeCliForLocalAgent(e.preset.id)
                    : CODE_CLI_TOOL_PRESETS.find((tool) => e.id === `cli:${tool.id}`)?.id
                  return renderContextMenu ? renderContextMenu(e.id, tool, e.name, row) : row
                }}
              />
            )
          })}
          {!entries.some((e) => e.name.toLowerCase().includes(query.toLowerCase())) && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('common.no_results')}</p>
          )}
        </Scrollbar>
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
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {renderCli && cliTool && entry?.id.startsWith('cli:') ? (
          renderCli(cliTool)
        ) : (
          <LocalAgentDetails
            closeSettingsOnChat={destination === '/settings/local-agents'}
            cliConfigEntry={renderCliConfig?.(cliTool ?? entry?.preset?.id ?? '')}
            key={entry?.id ?? selected}
            pendingSelection={
              pendingSelection &&
              pendingSelection !== selected &&
              pendingSelection !== entry?.id &&
              pendingSelection !== entry?.agent?.id
                ? pendingSelection
                : undefined
            }
            onNavigate={navigateToSelection}
            onCancelNavigation={cancelNavigation}
            preset={entry?.preset}
            agent={entry?.agent}
            detection={detections.find((d) => d.presetId === entry?.preset?.id)}
            onSaved={async (id, refreshInstallations = true) => {
              await refetch()
              setSelected(id)
              void navigate({ to: destination, search: { id }, replace: true })
              if (refreshInstallations) await refresh()
            }}
          />
        )}
      </main>
    </div>
  )
}

function LocalAgentDetails({
  cliConfigEntry,
  closeSettingsOnChat,
  pendingSelection,
  onNavigate,
  onCancelNavigation,
  preset,
  agent,
  detection,
  onSaved
}: {
  cliConfigEntry?: ReactNode
  closeSettingsOnChat: boolean
  pendingSelection?: string
  onNavigate: () => void
  onCancelNavigation: () => void
  preset?: LocalAgentPreset
  agent?: AgentEntity
  detection?: LocalAgentDetection
  onSaved: (id: string, refreshInstallations?: boolean) => Promise<void>
}) {
  const { t } = useTranslation()
  const { updateAgent } = useUpdateAgent()
  const tabs = useOptionalTabsContext()
  const currentTabId = useCurrentTabId()
  const initial: LocalAgentConfiguration = agent?.configuration?.localRuntime ?? {
    protocol: preset?.protocol ?? 'acp',
    presetId: preset?.id,
    enabled: false,
    args: [],
    env: {}
  }
  const [busyAction, setBusyAction] = useState<
    'save' | 'check' | 'toggle' | 'install' | 'uninstall' | 'confirm-uninstall' | 'model' | 'terminal'
  >()
  const {
    catalog,
    loading: modelsLoading,
    refresh: refreshModels
  } = useLocalAgentModelCatalog(
    preset?.id ?? agent?.id ?? 'custom-new',
    initial,
    !!(detection?.path || initial.executableOverride)
  )
  const modelSelection = useLocalAgentModelSelection(initial, catalog?.models ?? [])
  const version = useLocalAgentVersion(initial.executableOverride ? undefined : preset?.id, detection?.path)
  const [openingChat, setOpeningChat] = useState(false)
  const available = !!(detection?.path || initial.executableOverride)
  const busy = busyAction !== undefined || openingChat
  const modelSavingClass =
    busyAction === 'model' ? '[&_button:disabled]:pointer-events-auto [&_button:disabled]:opacity-100' : undefined
  const [result, setResult] = useState<{ message?: string; ok: boolean }>({ ok: false })
  const clearResult = () => setResult(({ ok }) => ({ ok }))
  const showError = (error: unknown) => setResult({ ok: false, message: String(error) })
  const [connection, setConnection] = useState<Pick<LocalAgentCheckResult, 'status' | 'version'>>()
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
  useEffect(() => {
    if (pendingSelection && !editing && !busy) onNavigate()
  }, [pendingSelection, editing, busy, onNavigate])
  const openTerminal = async () => {
    if (busy) return
    setBusyAction('terminal')
    try {
      if (preset?.terminalExecutable) {
        const detected = await ipcApi.request('ai.local_agents.detect', {})
        if (!detected.find((entry) => entry.presetId === preset.id)?.terminalPath) {
          if (
            !(await popup.confirm({
              title: `${preset.name} · ${t('code.terminal')}`,
              content: `${preset.terminalExecutable}: ${t('code.not_installed')}`,
              okText: t('code.install')
            }))
          )
            return
          await ipcApi.request('binary.install_tool', { name: preset.terminalExecutable })
        }
      }
      const response = await ipcApi.request('ai.local_agents.open_terminal', initial)
      if (!response.success) toast.error(response.message ?? t('common.error'))
    } catch (error) {
      toast.error(String(error))
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
        disabled={busy || !available}
        onClick={() => void openTerminal()}>
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
    setConnection(undefined)
    clearResult()
    setEditing(true)
  }
  const closeEditor = () => {
    setEditing(false)
    clearResult()
    if (pendingSelection) onNavigate()
  }
  const persistLocalRuntime = (localRuntime: LocalAgentConfiguration, name?: string) =>
    agent
      ? updateAgent({ id: agent.id, name, configuration: { localRuntime } }, { showSuccessToast: false })
      : createAgentAndRefresh(
          { type: 'local', name: name ?? preset?.name ?? '', model: null, configuration: { localRuntime } },
          async () => {}
        )
  const goToChat = async () => {
    if (busy || !agent || !initial.enabled) return
    if (!closeSettingsOnChat || !tabs || !currentTabId) {
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
      showError(error)
    }
  }
  const selectModel = async (nativeModel?: string) => {
    if (busy) return false
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
  const install = async (targetVersion?: string) => {
    if (!preset || busy) return
    setBusyAction('install')
    clearResult()
    try {
      const response = await ipcApi.request('ai.local_agents.install', { presetId: preset.id, targetVersion })
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
    } finally {
      setBusyAction(undefined)
    }
  }
  const uninstall = async () => {
    if (!preset || !detection?.path || busy) return
    const expectedPath = detection.path
    setBusyAction('confirm-uninstall')
    try {
      if (
        !(await popup.confirm({
          title: t('local_agents.uninstall_title', { name: preset.name }),
          content: (
            <div className="space-y-3">
              <p>{t('local_agents.uninstall_confirm')}</p>
              <p className="break-all text-xs text-muted-foreground">{expectedPath}</p>
            </div>
          ),
          okText: t('local_agents.uninstall'),
          okButtonProps: { danger: true }
        }))
      )
        return
      clearResult()
      setBusyAction('uninstall')
      const response = await ipcApi.request('ai.local_agents.uninstall', { presetId: preset.id, expectedPath })
      setResult({
        ok: response.ok,
        message: response.ok
          ? t('local_agents.uninstall_success')
          : [t(`local_agents.uninstall_error.${response.reason}`), response.detail].filter(Boolean).join('\n')
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
      const response = await ipcApi.request('ai.local_agents.check', initial)
      setConnection({ status: response.status, version: response.version ?? response.protocolInfo?.agent?.version })
      setResult({ ok: response.ok, message: response.ok ? undefined : checkError(response) })
    } catch (error) {
      setConnection({ status: 'failed' })
      showError(error)
    } finally {
      setBusyAction(undefined)
    }
  }
  const save = async (localRuntime: LocalAgentConfiguration, savedName: string, action: 'save' | 'toggle') => {
    if (busy) return false
    setBusyAction(action)
    clearResult()
    try {
      if (!savedName) throw new Error(t('local_agents.name_required'))
      if (localRuntime.enabled || (!preset && !agent)) {
        const response = await ipcApi.request('ai.local_agents.check', localRuntime)
        if (!response.ok) {
          showError(checkError(response))
          return false
        }
      }
      const updated = await persistLocalRuntime(localRuntime, savedName)
      if (updated) {
        toast.success(t('common.saved'))
        await onSaved(updated.id)
      }
      return !!updated
    } catch (error) {
      showError(error)
      return false
    } finally {
      setBusyAction(undefined)
    }
  }
  const feedbackMessage = result.message
  const classifiedError = feedbackMessage ? classifyLocalAgentError(feedbackMessage) : undefined
  const feedback = feedbackMessage && (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-xs',
        result.ok
          ? 'border-success-border bg-success-subtle text-success-subtle-foreground'
          : 'border-error-border bg-error-subtle text-error-subtle-foreground'
      )}>
      {result.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <CircleAlert className="size-4 shrink-0" />}
      <p className="min-w-0 whitespace-pre-wrap break-words">
        {classifiedError?.kind === 'authentication'
          ? t('local_agents.sign_in_required')
          : classifiedError?.kind === 'region'
            ? t('local_agents.auth_region_unavailable')
            : classifiedError?.message}
      </p>
    </div>
  )
  return (
    <>
      <Scrollbar className={cn('min-h-0 flex-1 overflow-x-hidden px-6 pt-3 pb-6', modelSavingClass)}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <section className="space-y-3">
            <AgentServiceCard
              title={
                preset ? (
                  <a className="text-inherit no-underline" href={preset.helpUrl} target="_blank" rel="noreferrer">
                    {agent?.name ?? preset.name}
                  </a>
                ) : (
                  (agent?.name ?? t('local_agents.custom'))
                )
              }
              icon={
                preset ? (
                  <a
                    className="shrink-0 rounded-full"
                    href={preset.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={agent?.name ?? preset.name}>
                    <LocalAgentIcon presetId={preset.id} size={36} />
                  </a>
                ) : (
                  <LocalAgentIcon size={36} />
                )
              }
              version={initial.executableOverride ? connection?.version : (version?.current ?? detection?.version)}
              controls={
                <>
                  {cliConfigEntry}
                  <Tooltip content={t('common.advanced_settings')} asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 rounded-lg text-foreground-tertiary hover:text-foreground"
                      aria-label={t('common.advanced_settings')}
                      disabled={busy}
                      onClick={openEditor}>
                      <Settings2 className="lucide-custom size-3.5 text-muted-foreground" />
                    </Button>
                  </Tooltip>
                </>
              }
              trailing={
                <>
                  {busyAction === 'toggle' && (
                    <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
                  )}
                  {
                    <Switch
                      aria-label={t('local_agents.enable')}
                      checked={initial.enabled}
                      disabled={busy || (!preset && !agent) || (!initial.enabled && !available)}
                      onCheckedChange={(enabled) =>
                        void save({ ...initial, enabled }, agent?.name ?? preset?.name ?? '', 'toggle')
                      }
                    />
                  }
                </>
              }
              actions={
                <>
                  {available ? (
                    <>
                      {version?.canUpgrade && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg border-border-subtle text-xs shadow-none"
                          disabled={busy}
                          onClick={() => void install(version.latest)}>
                          {busyAction === 'install' ? (
                            <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            <ArrowUpCircle className="lucide-custom size-3.5 text-muted-foreground" />
                          )}
                          {t('code.upgrade')}
                          {version.latest && ` v${version.latest}`}
                        </Button>
                      )}
                      {terminalButton}
                      <LocalAgentWebUiActions config={initial} disabled={busy || !available} />
                      {initial.enabled && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 rounded-lg border-border-subtle text-xs shadow-none"
                          disabled={busy || !agent}
                          onClick={() => void goToChat()}>
                          <MessageSquare className="lucide-custom size-3.5 text-muted-foreground" />
                          {t('title.chat')}
                        </Button>
                      )}
                    </>
                  ) : preset ? (
                    <Button
                      size="sm"
                      className="h-8 shrink-0 rounded-lg border border-transparent text-xs shadow-none"
                      disabled={busy}
                      onClick={() => void install()}>
                      {busyAction === 'install' ? (
                        <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {t(busyAction === 'install' ? 'local_agents.installing' : 'code.install')}
                    </Button>
                  ) : !agent ? (
                    <Button size="sm" onClick={openEditor}>
                      {t('common.settings')}
                    </Button>
                  ) : null}
                </>
              }>
              <div className="flex items-start justify-end gap-2">
                {(initial.executableOverride ?? detection?.path ?? preset?.executable) && (
                  <InputGroup
                    aria-label={t('local_agents.installation_location')}
                    onMouseEnter={() => setProgramHovered(true)}
                    onMouseLeave={() => setProgramHovered(false)}
                    className={cn(
                      'h-8 min-w-0 flex-1 rounded-lg border-border-subtle bg-muted/30 shadow-none transition-colors motion-reduce:transition-none',
                      connection?.status === 'ready' && 'border-success-border bg-success-subtle',
                      connection?.status === 'authentication-required' && 'border-warning-border bg-warning-subtle',
                      connection &&
                        !['ready', 'authentication-required'].includes(connection.status) &&
                        'border-error-border bg-error-subtle'
                    )}>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={openEditor}
                      aria-label={t('local_agents.installation_location')}
                      className="h-full min-w-0 flex-1 justify-start rounded-lg px-2.5 text-left font-normal hover:bg-transparent">
                      <span dir="rtl" className="min-w-0 truncate text-left font-mono text-xs text-foreground">
                        <bdi dir="ltr">{initial.executableOverride ?? detection?.path ?? preset?.executable}</bdi>
                      </span>
                    </Button>
                    <InputGroupAddon align="inline-end" className="shrink-0 gap-1 py-0 pr-1">
                      <span
                        role="status"
                        aria-live="polite"
                        className="flex items-center gap-1 whitespace-nowrap text-[11px]">
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
                              connection.version &&
                              ` · ${/^v/i.test(connection.version) ? connection.version : `v${connection.version}`}`}
                          </span>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="px-1.5 py-0 text-[11px] leading-4 text-muted-foreground">
                            {initial.executableOverride
                              ? t('settings.provider.not_checked')
                              : detection?.path
                                ? t('local_agents.detected')
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
              </div>
            </AgentServiceCard>
            {!editing && feedback}
            {(preset || agent) && !LOCAL_AGENT_MODEL_CONFIG[initial.presetId ?? ''] && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('local_agents.global_model_unavailable')}
              </p>
            )}
            {(preset || agent) && (
              <LocalAgentModelList
                models={modelSelection.models}
                groupFallback={agent?.name ?? preset?.name}
                value={modelSelection.value}
                disabled={busy || !LOCAL_AGENT_MODEL_CONFIG[initial.presetId ?? '']}
                loading={modelsLoading}
                loaded={!!catalog}
                loadDisabled={!detection?.path && !initial.executableOverride}
                onLoad={loadModels}
                onSelect={selectModel}
              />
            )}
          </section>
        </div>
      </Scrollbar>
      {editing && (
        <LocalAgentAdvancedSettings
          config={initial}
          name={agent?.name ?? preset?.name ?? ''}
          preset={preset}
          detection={detection}
          hasAgent={!!agent}
          busyAction={busyAction}
          pendingSelection={pendingSelection}
          feedback={feedback}
          onClose={closeEditor}
          onCancelNavigation={onCancelNavigation}
          onChange={clearResult}
          onError={showError}
          onUninstall={uninstall}
          onSave={(localRuntime, name) => save(localRuntime, name, 'save')}
        />
      )}
    </>
  )
}
