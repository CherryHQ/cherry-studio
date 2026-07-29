import { loggerService } from '@logger'
import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { defineTool, type ToolRenderContext, TopicType } from '@renderer/components/composer/tools/types'
import { type QuickPanelInputAdapter, type QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import {
  openResourceEditDialog,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentMutationsById, useAssistantMutationsById } from '@renderer/hooks/resourceCatalog'
import { useMcpRuntimeStatusMap } from '@renderer/hooks/useMcpRuntimeStatus'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@renderer/types/assistant'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { McpMode } from '@shared/data/types/assistant'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { TFunction } from 'i18next'
import { Cable, Check, Loader2, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const MCP_STATUS_LAUNCHER_ID = 'mcp-status'

const logger = loggerService.withContext('mcpStatusTool')

type McpStatusToolContext = ToolRenderContext<readonly [], readonly []>
type McpStatusAgent = { mcps?: string[] } | undefined
const MCP_RUNTIME_STATUS_LABEL_KEYS: Record<McpRuntimeStatus['state'], string> = {
  connected: 'settings.mcp.runtimeStatus.connected',
  connecting: 'settings.mcp.runtimeStatus.connecting',
  disabled: 'settings.mcp.runtimeStatus.disabled',
  error: 'settings.mcp.runtimeStatus.error'
}
const MCP_MODE_LABEL_KEYS: Record<McpMode, string> = {
  auto: 'library.config.tools.mode.auto.label',
  disabled: 'library.config.tools.mode.disabled.label',
  manual: 'library.config.tools.mode.manual.label'
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

function getMcpModeLabel(t: TFunction, mode: McpMode) {
  return t(MCP_MODE_LABEL_KEYS[mode], mode)
}

function createEmptyMcpStatusItem(label: string): QuickPanelListItem {
  return {
    id: 'mcp-status-empty',
    label,
    icon: <Cable />,
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
    icon: <Cable />
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

  if (!assistant || assistant.settings?.mcpMode !== 'manual') return false
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

  const mode = assistant?.settings?.mcpMode ?? 'disabled'
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
): QuickPanelListItem | null {
  if (!target) return null
  return {
    id: 'mcp-status:open-config',
    label: t('settings.quickPanel.mcp.open_config', 'Configure MCP servers'),
    icon: <Settings2 />,
    fixedToBottom: true,
    action: () => openResourceEditDialog(target)
  }
}

function clearMcpStatusInputQuery(
  inputAdapter: QuickPanelInputAdapter | undefined,
  queryAnchor: number | undefined,
  triggerInfo: { type: 'input' | 'button' } | undefined
) {
  if (!inputAdapter || triggerInfo?.type !== 'input' || queryAnchor === undefined) return

  const text = inputAdapter.getText()
  const cursorOffset = inputAdapter.getCursorOffset?.() ?? text.length
  if (cursorOffset < queryAnchor) return

  inputAdapter.deleteTriggerRange({ from: queryAnchor, to: cursorOffset })
  inputAdapter.focus()
}

export function createMcpStatusLauncher(
  items: QuickPanelListItem[],
  t: TFunction,
  mode?: McpMode,
  editable = false
): ComposerToolLauncher {
  const modeLabel = mode ? getMcpModeLabel(t, mode) : undefined
  const isDisabled = mode === 'disabled'

  return {
    id: MCP_STATUS_LAUNCHER_ID,
    kind: 'panel',
    sources: ['root-panel'],
    order: 50,
    label: 'MCP',
    // The panel stays reachable even when MCP is disabled — it surfaces the disabled state alongside
    // the "Configure MCP servers" footer, which is exactly the moment the user needs to open config.
    description:
      isDisabled && modeLabel
        ? modeLabel
        : t('settings.quickPanel.mcp.description', 'View configured MCP server status'),
    icon: <Cable />,
    action: ({ inputAdapter, parentPanel, queryAnchor, quickPanel, triggerInfo }) => {
      clearMcpStatusInputQuery(inputAdapter, queryAnchor, triggerInfo)
      quickPanel.open({
        title: mode ? `MCP / ${getMcpModeLabel(t, mode)}` : 'MCP',
        list: items,
        symbol: ComposerPanelSymbol.McpStatus,
        parentPanel,
        queryAnchor,
        triggerInfo: triggerInfo ?? { type: 'button' },
        readOnly: !editable
      })
    }
  }
}

export const McpStatusComposerRuntime = ({ context }: { context: McpStatusToolContext }) => {
  const { assistant, launcher, scope, session, t } = context
  const { isVisible, symbol, updateList } = useQuickPanel()
  const { mcpServers } = useMcpServers()
  const mcpStatuses = useMcpRuntimeStatusMap(mcpServers)
  const { agent } = useAgent(scope === TopicType.Session ? (session?.agentId ?? null) : null)
  const { updateAssistant } = useAssistantMutationsById(assistant?.id ?? '')
  const { updateAgent } = useAgentMutationsById(session?.agentId ?? '')
  const [pendingServerId, setPendingServerId] = useState<string | null>(null)
  const bindingMutationInFlightRef = useRef(false)
  const mode = scope === TopicType.Chat ? (assistant?.settings?.mcpMode ?? 'disabled') : undefined
  const bindingPanelEditable = scope === TopicType.Session || mode === 'manual'
  const canEditBindings =
    scope === TopicType.Session ? Boolean(session?.agentId && agent) : Boolean(assistant?.id && mode === 'manual')

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
    const footer = buildMcpConfigFooterItem(configTarget, t)
    return footer ? [...statusItems, footer] : statusItems
  }, [
    agent,
    assistant,
    bindingPanelEditable,
    canEditBindings,
    configTarget,
    handleToggleBinding,
    mcpServers,
    mcpStatuses,
    pendingServerId,
    scope,
    t
  ])

  const mcpStatusLauncher = useMemo(
    () => createMcpStatusLauncher(items, t, mode, bindingPanelEditable),
    [bindingPanelEditable, items, mode, t]
  )

  useEffect(() => launcher.registerLaunchers([mcpStatusLauncher]), [launcher, mcpStatusLauncher])

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
