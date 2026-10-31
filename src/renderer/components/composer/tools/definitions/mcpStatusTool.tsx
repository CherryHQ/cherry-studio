import type { TFunction } from 'i18next'
import { Check, Globe2, Loader2, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { ComposerPanelSymbol, prepareComposerQuickPanelSearch } from '@renderer/components/composer/quickPanel'
import type { ComposerToolFooterAction, ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { isMcpToolbarActive } from '@renderer/components/composer/tools/definitions/mcpToolbarState'
import { defineTool, type ToolRenderContext, TopicType } from '@renderer/components/composer/tools/types'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import { type QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentMutationsById, useAssistantMutationsById } from '@renderer/hooks/resourceCatalog'
import { useMcpRuntimeStatusMap } from '@renderer/hooks/useMcpRuntimeStatus'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@renderer/types/assistant'
import type { ResourceEditDialogTarget } from '@renderer/types/resourceCatalog'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import { DEFAULT_MCP_MODE, type McpMode } from '@shared/data/types/assistant'
import type { McpServer } from '@shared/data/types/mcpServer'

export const MCP_STATUS_LAUNCHER_ID = 'mcp-status'

const logger = loggerService.withContext('mcpStatusTool')

type McpStatusToolContext = ToolRenderContext<readonly [], readonly []>
type McpStatusAgent = { mcps?: string[] } | undefined
const MCP_RUNTIME_STATUS_LABEL_KEYS: Record<McpRuntimeStatus['state'], string> = {
  connected: 'settings.mcp.runtimeStatus.connected',
  connecting: 'settings.mcp.runtimeStatus.connecting',
  disabled: 'settings.mcp.runtimeStatus.disconnected',
  error: 'settings.mcp.runtimeStatus.failed'
}
const MCP_MODE_LABEL_KEYS: Record<McpMode, string> = {
  auto: 'library.config.tools.mode.auto.label',
  disabled: 'library.config.tools.mode.disabled.label',
  manual: 'library.config.tools.mode.manual.label'
}

type McpToolbarConnectionState = 'connected' | 'connecting' | 'disconnected' | 'failed'

interface McpToolbarStatusSummary {
  state: McpToolbarConnectionState
  tooltip: string
}

const MCP_TOOLBAR_STATE_LABEL_KEYS: Record<McpToolbarConnectionState, string> = {
  connected: MCP_RUNTIME_STATUS_LABEL_KEYS.connected,
  connecting: MCP_RUNTIME_STATUS_LABEL_KEYS.connecting,
  disconnected: MCP_RUNTIME_STATUS_LABEL_KEYS.disabled,
  failed: MCP_RUNTIME_STATUS_LABEL_KEYS.error
}

const MCP_TOOLBAR_INDICATOR_CLASSES: Record<McpToolbarConnectionState, string> = {
  connected: 'bg-success-subtle-foreground',
  connecting: 'bg-warning-subtle-foreground',
  disconnected: 'bg-muted-foreground',
  failed: 'bg-error-subtle-foreground'
}

interface BuildMcpStatusItemsOptions {
  assistant?: Assistant
  agent?: McpStatusAgent
  canEditBindings?: boolean
  mcpServers: readonly McpServer[]
  mcpStatuses: Record<string, McpRuntimeStatus | undefined>
  onToggleBinding?: (id: string, enabled: boolean) => void
  pendingServerId?: string | null
  scope: TopicType.Chat | TopicType.Session
  t: TFunction
}

interface UpdateMcpBindingOptions {
  assistant?: Assistant
  agent?: McpStatusAgent
  enabled: boolean
  scope: TopicType.Chat | TopicType.Session
  serverId: string
  updateAgent: (patch: { mcps: string[] }) => Promise<unknown>
  updateAssistant: (patch: { mcpServerIds: string[] }) => Promise<unknown>
}

function getMcpStatusLabel(t: TFunction, state: McpRuntimeStatus['state']) {
  return t(MCP_RUNTIME_STATUS_LABEL_KEYS[state], state)
}

export function getMcpToolbarServers({
  assistant,
  agent,
  mcpServers,
  scope
}: {
  assistant?: Assistant
  agent?: McpStatusAgent
  mcpServers: readonly McpServer[]
  scope: TopicType.Chat | TopicType.Session
}): McpServer[] {
  if (scope === TopicType.Session) {
    const boundIds = new Set(agent?.mcps ?? [])
    return mcpServers.filter((server) => boundIds.has(server.id))
  }

  const mode = assistant ? (assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE) : 'disabled'
  if (mode === 'disabled') return []
  if (mode === 'auto') return mcpServers.filter((server) => server.isActive)

  const boundIds = new Set(assistant?.mcpServerIds ?? [])
  return mcpServers.filter((server) => boundIds.has(server.id))
}

export function buildMcpToolbarStatus(
  servers: readonly McpServer[],
  mcpStatuses: Record<string, McpRuntimeStatus | undefined>,
  t: TFunction
): McpToolbarStatusSummary | undefined {
  if (servers.length === 0) return undefined

  const entries = servers.map((server) => {
    const status = server.isActive ? (mcpStatuses[server.id]?.state ?? 'connecting') : 'disabled'
    const state: McpToolbarConnectionState =
      status === 'error' ? 'failed' : status === 'disabled' ? 'disconnected' : status
    const label =
      state === 'connecting' && mcpStatuses[server.id]?.authorizing
        ? t('settings.mcp.runtimeStatus.authorizing', 'Waiting for authorization')
        : t(MCP_TOOLBAR_STATE_LABEL_KEYS[state], state)

    return { state, tooltip: `${server.name}: ${label}` }
  })

  const state = entries.some((entry) => entry.state === 'failed')
    ? 'failed'
    : entries.some((entry) => entry.state === 'connecting')
      ? 'connecting'
      : entries.some((entry) => entry.state === 'disconnected')
        ? 'disconnected'
        : 'connected'

  return { state, tooltip: entries.map((entry) => entry.tooltip).join(' · ') }
}

function getMcpModeLabel(t: TFunction, mode: McpMode) {
  return t(MCP_MODE_LABEL_KEYS[mode], mode)
}

function McpStatusIcon({ state }: { state?: McpToolbarConnectionState }) {
  return (
    <span className="relative inline-flex">
      <McpLogo aria-hidden />
      {state ? (
        <span
          aria-hidden
          className={`absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-background ${MCP_TOOLBAR_INDICATOR_CLASSES[state]}`}
        />
      ) : null}
    </span>
  )
}

function createEmptyMcpStatusItem(label: string): QuickPanelListItem {
  return {
    id: 'mcp-status-empty',
    label,
    icon: <McpLogo aria-hidden />,
    disabled: true
  }
}

function createMcpStatusItem(
  server: McpServer,
  status: McpRuntimeStatus | undefined,
  t: TFunction
): QuickPanelListItem {
  const state = server?.isActive ? (status?.state ?? 'connecting') : 'disabled'
  const description = getMcpStatusLabel(t, state)

  return {
    id: `mcp-status:${server.id}`,
    label: server.name,
    description,
    filterText: [server.name, server.description, description].filter(Boolean).join(' '),
    icon: <McpLogo aria-hidden />
  }
}

function buildBindingServerItems(
  servers: readonly McpServer[],
  boundIds: ReadonlySet<string>,
  mcpStatuses: Record<string, McpRuntimeStatus | undefined>,
  t: TFunction,
  options: Pick<BuildMcpStatusItemsOptions, 'canEditBindings' | 'onToggleBinding' | 'pendingServerId'>
) {
  return servers.map((server) => {
    const item = createMcpStatusItem(server, mcpStatuses[server.id], t)
    const isBound = boundIds.has(server.id)
    const isSaving = options.pendingServerId === server.id
    const hasPendingSave = options.pendingServerId != null
    const canToggle = Boolean(
      options.canEditBindings && options.onToggleBinding && !hasPendingSave && (server.isActive || isBound)
    )
    const handleToggle = (enabled: boolean) => {
      if (!canToggle) return
      options.onToggleBinding?.(server.id, enabled)
    }

    return {
      ...item,
      action: canToggle ? () => handleToggle(!isBound) : undefined,
      disabled: !canToggle,
      isSelected: isBound,
      keepOpenOnAction: true,
      suffix: isSaving ? (
        <span role="status" aria-label={t('common.loading', 'Loading...')}>
          <Loader2 className="animate-spin" aria-hidden />
        </span>
      ) : isBound ? (
        <>
          <span className="sr-only">{t('common.selected', 'Selected')}</span>
          <Check aria-hidden />
        </>
      ) : undefined
    } satisfies QuickPanelListItem
  })
}

function nextBindingIds(ids: readonly string[], serverId: string, enabled: boolean) {
  return enabled ? Array.from(new Set([...ids, serverId])) : ids.filter((id) => id !== serverId)
}

export async function updateMcpBinding({
  assistant,
  agent,
  enabled,
  scope,
  serverId,
  updateAgent,
  updateAssistant
}: UpdateMcpBindingOptions): Promise<boolean> {
  if (scope === TopicType.Session) {
    if (!agent) return false
    await updateAgent({ mcps: nextBindingIds(agent.mcps ?? [], serverId, enabled) })
    return true
  }

  if (!assistant || (assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE) !== 'manual') return false
  await updateAssistant({ mcpServerIds: nextBindingIds(assistant.mcpServerIds ?? [], serverId, enabled) })
  return true
}

export function buildMcpStatusItems({
  assistant,
  agent,
  canEditBindings,
  mcpServers,
  mcpStatuses,
  onToggleBinding,
  pendingServerId,
  scope,
  t
}: BuildMcpStatusItemsOptions): QuickPanelListItem[] {
  if (scope === TopicType.Session) {
    if (mcpServers.length === 0) {
      return [createEmptyMcpStatusItem(t('settings.quickPanel.mcp.agentEmpty', 'No MCP servers configured'))]
    }
    return buildBindingServerItems(mcpServers, new Set(agent?.mcps ?? []), mcpStatuses, t, {
      canEditBindings,
      onToggleBinding,
      pendingServerId
    })
  }

  const mode = assistant ? (assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE) : 'disabled'
  if (mode === 'disabled') {
    return [createEmptyMcpStatusItem(t('settings.quickPanel.mcp.disabled', 'MCP is disabled'))]
  }

  if (mode === 'auto') {
    const activeServers = mcpServers.filter((server) => server.isActive)
    if (activeServers.length === 0) {
      return [createEmptyMcpStatusItem(t('settings.quickPanel.mcp.autoEmpty', 'No enabled MCP servers'))]
    }
    return activeServers.map((server) => createMcpStatusItem(server, mcpStatuses[server.id], t))
  }

  if (mcpServers.length === 0) {
    return [createEmptyMcpStatusItem(t('settings.quickPanel.mcp.assistantEmpty', 'No MCP servers configured'))]
  }
  return buildBindingServerItems(mcpServers, new Set(assistant?.mcpServerIds ?? []), mcpStatuses, t, {
    canEditBindings,
    onToggleBinding,
    pendingServerId
  })
}

export function resolveMcpConfigTarget(options: {
  scope: TopicType.Chat | TopicType.Session
  assistantId?: string
  agentId?: string
}): ResourceEditDialogTarget | null {
  if (options.scope === TopicType.Session) {
    return options.agentId ? { kind: 'agent', id: options.agentId, initialTab: 'tools.mcp' } : null
  }
  return options.assistantId ? { kind: 'assistant', id: options.assistantId, initialTab: 'tools.mcp' } : null
}

export function buildMcpConfigFooterItem(
  target: ResourceEditDialogTarget | null,
  t: TFunction
): ComposerToolFooterAction | null {
  if (!target) return null
  const ariaLabel =
    target.kind === 'assistant'
      ? t('settings.quickPanel.mcp.manageCurrentAssistant')
      : t('settings.quickPanel.mcp.manageCurrentAgent')
  return {
    id: 'mcp-status:open-config',
    panelSymbol: ComposerPanelSymbol.McpStatus,
    order: 10,
    label:
      target.kind === 'assistant'
        ? t('settings.quickPanel.scope.currentAssistant')
        : t('settings.quickPanel.scope.currentAgent'),
    ariaLabel,
    tooltip: ariaLabel,
    icon: <Settings2 />,
    action: () => openResourceEditDialog(target)
  }
}

export function buildMcpGlobalConfigFooterItem(t: TFunction): ComposerToolFooterAction {
  const ariaLabel = t('settings.quickPanel.mcp.manageGlobal')
  return {
    id: 'mcp-status:open-global-config',
    panelSymbol: ComposerPanelSymbol.McpStatus,
    order: 20,
    label: t('settings.quickPanel.scope.global'),
    ariaLabel,
    tooltip: ariaLabel,
    icon: <Globe2 />,
    action: () => openSettingsTab('/settings/mcp/servers')
  }
}

export function createMcpStatusLauncher(
  items: QuickPanelListItem[],
  t: TFunction,
  mode?: McpMode,
  editable = false,
  onOpen?: () => void,
  active = false,
  status?: McpToolbarStatusSummary
): ComposerToolLauncher {
  const modeLabel = mode ? getMcpModeLabel(t, mode) : undefined
  const isDisabled = mode === 'disabled'
  const description =
    isDisabled && modeLabel ? modeLabel : t('settings.quickPanel.mcp.description', 'View configured MCP server status')

  return {
    id: MCP_STATUS_LAUNCHER_ID,
    kind: 'panel',
    sources: ['root-panel'],
    order: 50,
    label: 'MCP',
    active,
    // The panel stays reachable even when MCP is disabled — it surfaces the disabled state alongside
    // the "Configure MCP servers" footer, which is exactly the moment the user needs to open config.
    description,
    tooltip: status?.tooltip ?? description,
    icon: <McpStatusIcon state={status?.state} />,
    action: ({ inputAdapter, parentPanel, queryAnchor, quickPanel, triggerInfo }) => {
      onOpen?.()
      quickPanel.open({
        title: mode ? `MCP / ${getMcpModeLabel(t, mode)}` : 'MCP',
        list: items,
        symbol: ComposerPanelSymbol.McpStatus,
        parentPanel,
        ...prepareComposerQuickPanelSearch({ inputAdapter, queryAnchor, triggerInfo }),
        readOnly: !editable
      })
    }
  }
}

export const McpStatusComposerRuntime = ({ context }: { context: McpStatusToolContext }) => {
  const { assistant, launcher, scope, session, t } = context
  const { isVisible, symbol, updateList } = useQuickPanel()
  const [dataRequested, setDataRequested] = useState(false)
  const mode =
    scope === TopicType.Chat ? (assistant ? (assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE) : 'disabled') : undefined
  const { agent } = useAgent(scope === TopicType.Session ? (session?.agentId ?? null) : null)
  const toolbarActive = useMemo(
    () =>
      isMcpToolbarActive({
        scope: scope === TopicType.Session ? TopicType.Session : TopicType.Chat,
        assistant,
        agent
      }),
    [agent, assistant, scope]
  )
  const dataEnabled = toolbarActive || (dataRequested && (scope === TopicType.Session || mode !== 'disabled'))
  const { mcpServers, isLoading: isMcpServersLoading } = useMcpServers(undefined, { enabled: dataEnabled })
  const mcpStatuses = useMcpRuntimeStatusMap(mcpServers)
  const { updateAssistant } = useAssistantMutationsById(assistant?.id ?? '')
  const { updateAgent } = useAgentMutationsById(session?.agentId ?? '')
  const [pendingServerId, setPendingServerId] = useState<string | null>(null)
  const bindingMutationInFlightRef = useRef(false)
  const bindingPanelEditable = scope === TopicType.Session || mode === 'manual'
  const canEditBindings =
    scope === TopicType.Session ? Boolean(session?.agentId && agent) : Boolean(assistant?.id && mode === 'manual')

  const toolbarStatus = useMemo(() => {
    const servers = getMcpToolbarServers({
      assistant,
      agent,
      mcpServers,
      scope: scope === TopicType.Session ? TopicType.Session : TopicType.Chat
    })
    return buildMcpToolbarStatus(servers, mcpStatuses, t)
  }, [agent, assistant, mcpServers, mcpStatuses, scope, t])

  const handleToggleBinding = useCallback(
    async (serverId: string, enabled: boolean) => {
      if (bindingMutationInFlightRef.current) return

      bindingMutationInFlightRef.current = true
      setPendingServerId(serverId)
      try {
        await updateMcpBinding({
          assistant,
          agent,
          enabled,
          scope: scope === TopicType.Session ? TopicType.Session : TopicType.Chat,
          serverId,
          updateAgent,
          updateAssistant
        })
      } catch (error) {
        logger.error('Failed to update MCP binding from the composer', error as Error, { scope, serverId })
        toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
      } finally {
        bindingMutationInFlightRef.current = false
        setPendingServerId(null)
      }
    },
    [agent, assistant, scope, t, updateAgent, updateAssistant]
  )

  const configTarget = useMemo<ResourceEditDialogTarget | null>(
    () =>
      resolveMcpConfigTarget({
        scope: scope === TopicType.Session ? TopicType.Session : TopicType.Chat,
        assistantId: assistant?.id,
        agentId: session?.agentId
      }),
    [assistant?.id, scope, session?.agentId]
  )

  const items = useMemo(() => {
    if (dataEnabled && isMcpServersLoading && mcpServers.length === 0) {
      return [
        {
          id: 'mcp-status-loading',
          label: t('common.loading', 'Loading...'),
          icon: <Loader2 className="animate-spin" aria-hidden />,
          disabled: true
        }
      ]
    }
    const statusItems = buildMcpStatusItems({
      assistant,
      agent,
      canEditBindings,
      mcpServers,
      mcpStatuses,
      onToggleBinding: bindingPanelEditable ? handleToggleBinding : undefined,
      pendingServerId,
      scope: scope === TopicType.Session ? TopicType.Session : TopicType.Chat,
      t
    })
    return statusItems
  }, [
    agent,
    assistant,
    bindingPanelEditable,
    canEditBindings,
    dataEnabled,
    handleToggleBinding,
    isMcpServersLoading,
    mcpServers,
    mcpStatuses,
    pendingServerId,
    scope,
    t
  ])

  const footerActions = useMemo(() => {
    const currentAction = buildMcpConfigFooterItem(configTarget, t)
    return currentAction ? [currentAction, buildMcpGlobalConfigFooterItem(t)] : [buildMcpGlobalConfigFooterItem(t)]
  }, [configTarget, t])

  const mcpStatusLauncher = useMemo(
    () =>
      createMcpStatusLauncher(
        items,
        t,
        mode,
        bindingPanelEditable,
        () => setDataRequested(true),
        toolbarActive,
        toolbarStatus
      ),
    [bindingPanelEditable, items, mode, t, toolbarActive, toolbarStatus]
  )

  useEffect(
    () => launcher.registerLaunchers([mcpStatusLauncher], footerActions),
    [footerActions, launcher, mcpStatusLauncher]
  )

  useEffect(() => {
    if (!isVisible || symbol !== ComposerPanelSymbol.McpStatus) return
    updateList(items)
  }, [isVisible, items, symbol, updateList])

  return null
}

const mcpStatusTool = defineTool({
  key: 'mcp_status',
  label: 'MCP',
  visibleInScopes: [TopicType.Chat, TopicType.Session],
  composer: {
    runtime: ({ context }) => <McpStatusComposerRuntime context={context} />
  }
})

export default mcpStatusTool
