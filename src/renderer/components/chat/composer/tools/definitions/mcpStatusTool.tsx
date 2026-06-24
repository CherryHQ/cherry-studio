import { ComposerPanelSymbol } from '@renderer/components/chat/composer/quickPanel/symbols'
import type { ComposerToolLauncher } from '@renderer/components/chat/composer/toolLauncher'
import {
  defineTool,
  registerTool,
  type ToolRenderContext,
  TopicType
} from '@renderer/components/chat/composer/tools/types'
import { type QuickPanelInputAdapter, type QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useMcpRuntimeStatusMap } from '@renderer/hooks/useMcpRuntimeStatus'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import type { Assistant } from '@renderer/types'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { McpMode } from '@shared/data/types/assistant'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { TFunction } from 'i18next'
import { Cable } from 'lucide-react'
import { useEffect, useMemo } from 'react'

export const MCP_STATUS_LAUNCHER_ID = 'mcp-status'

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
  mcpServers: readonly McpServer[]
  mcpStatuses: Record<string, McpRuntimeStatus | undefined>
  scope: TopicType.Chat | TopicType.Session
  t: TFunction
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
  server: McpServer | undefined,
  id: string,
  status: McpRuntimeStatus | undefined,
  t: TFunction
): QuickPanelListItem {
  const state = server?.isActive ? (status?.state ?? 'connecting') : 'disabled'
  const description = getMcpStatusLabel(t, state)

  return {
    id: `mcp-status:${id}`,
    label: server?.name ?? t('settings.quickPanel.mcp.unknownServer', 'Unknown MCP server'),
    description,
    filterText: [server?.name, server?.description, description].filter(Boolean).join(' '),
    icon: <Cable />
  }
}

function mapServersById(servers: readonly McpServer[]) {
  return new Map(servers.map((server) => [server.id, server]))
}

function buildBoundServerItems(
  ids: readonly string[],
  serverById: ReadonlyMap<string, McpServer>,
  mcpStatuses: Record<string, McpRuntimeStatus | undefined>,
  t: TFunction
) {
  return ids.map((id) => createMcpStatusItem(serverById.get(id), id, mcpStatuses[id], t))
}

export function buildMcpStatusItems({
  assistant,
  agent,
  mcpServers,
  mcpStatuses,
  scope,
  t
}: BuildMcpStatusItemsOptions): QuickPanelListItem[] {
  const serverById = mapServersById(mcpServers)

  if (scope === TopicType.Session) {
    const agentMcpIds = agent?.mcps ?? []
    if (agentMcpIds.length === 0) {
      return [createEmptyMcpStatusItem(t('settings.quickPanel.mcp.agentEmpty', 'No MCP servers configured'))]
    }
    return buildBoundServerItems(agentMcpIds, serverById, mcpStatuses, t)
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
    return activeServers.map((server) => createMcpStatusItem(server, server.id, mcpStatuses[server.id], t))
  }

  const assistantMcpIds = assistant?.mcpServerIds ?? []
  if (assistantMcpIds.length === 0) {
    return [createEmptyMcpStatusItem(t('settings.quickPanel.mcp.assistantEmpty', 'No MCP servers configured'))]
  }
  return buildBoundServerItems(assistantMcpIds, serverById, mcpStatuses, t)
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
  mode?: McpMode
): ComposerToolLauncher {
  const modeLabel = mode ? getMcpModeLabel(t, mode) : undefined
  const isDisabled = mode === 'disabled'

  return {
    id: MCP_STATUS_LAUNCHER_ID,
    kind: 'panel',
    sources: ['root-panel'],
    order: 50,
    label: 'MCP',
    description:
      isDisabled && modeLabel
        ? modeLabel
        : t('settings.quickPanel.mcp.description', 'View configured MCP server status'),
    disabledReason: isDisabled ? modeLabel : undefined,
    disabled: isDisabled,
    icon: <Cable />,
    action: isDisabled
      ? undefined
      : ({ inputAdapter, parentPanel, queryAnchor, quickPanel, triggerInfo }) => {
          clearMcpStatusInputQuery(inputAdapter, queryAnchor, triggerInfo)
          quickPanel.open({
            title: mode ? `MCP / ${getMcpModeLabel(t, mode)}` : 'MCP',
            list: items,
            symbol: ComposerPanelSymbol.McpStatus,
            parentPanel,
            queryAnchor,
            triggerInfo: triggerInfo ?? { type: 'button' },
            readOnly: true
          })
        }
  }
}

const McpStatusComposerRuntime = ({ context }: { context: McpStatusToolContext }) => {
  const { assistant, launcher, scope, session, t } = context
  const { isVisible, symbol, updateList } = useQuickPanel()
  const { mcpServers } = useMcpServers()
  const mcpStatuses = useMcpRuntimeStatusMap(mcpServers)
  const { agent } = useAgent(scope === TopicType.Session ? (session?.agentId ?? null) : null)
  const mode = scope === TopicType.Chat ? (assistant?.settings?.mcpMode ?? 'disabled') : undefined

  const items = useMemo(
    () =>
      buildMcpStatusItems({
        assistant,
        agent,
        mcpServers,
        mcpStatuses,
        scope: scope === TopicType.Session ? TopicType.Session : TopicType.Chat,
        t
      }),
    [agent, assistant, mcpServers, mcpStatuses, scope, t]
  )

  const mcpStatusLauncher = useMemo(() => createMcpStatusLauncher(items, t, mode), [items, mode, t])

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

registerTool(mcpStatusTool)

export default mcpStatusTool
