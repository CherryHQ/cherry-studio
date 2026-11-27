import { act, render, waitFor } from '@testing-library/react'
import { Globe2 } from 'lucide-react'
import { isValidElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { McpServer } from '@shared/data/types/mcpServer'

const mocks = vi.hoisted(() => ({
  agent: undefined as { mcps?: string[] } | undefined,
  agentIds: [] as Array<string | null>,
  loggerError: vi.fn(),
  mcpServers: [] as McpServer[],
  mcpServerOptions: [] as Array<{ enabled?: boolean } | undefined>,
  open: vi.fn(),
  openSettingsTab: vi.fn(),
  registerLaunchers: vi.fn<(launchers: unknown[], footerActions?: unknown[]) => () => void>(() => () => undefined),
  toastError: vi.fn(),
  updateAgent: vi.fn(),
  updateAssistant: vi.fn(),
  updateList: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: (id: string | null) => {
    mocks.agentIds.push(id)
    return { agent: id ? mocks.agent : undefined }
  }
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => ({})
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: (_query: unknown, options?: { enabled?: boolean }) => {
    mocks.mcpServerOptions.push(options)
    return { mcpServers: mocks.mcpServers, isLoading: false }
  }
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useAgentMutationsById: () => ({ updateAgent: mocks.updateAgent }),
  useAssistantMutationsById: () => ({ updateAssistant: mocks.updateAssistant })
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  useQuickPanel: () => ({
    isVisible: true,
    symbol: ComposerPanelSymbol.McpStatus,
    updateList: mocks.updateList
  })
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

const editDialogMocks = vi.hoisted(() => ({ openResourceEditDialog: vi.fn() }))
vi.mock('@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost', () => ({
  openResourceEditDialog: editDialogMocks.openResourceEditDialog
}))

import type { Assistant } from '@renderer/types/assistant'

import { TopicType } from '../../types'
import {
  buildMcpConfigFooterItem,
  buildMcpGlobalConfigFooterItem,
  buildMcpStatusItems,
  createMcpStatusLauncher,
  McpStatusComposerRuntime,
  resolveMcpConfigTarget,
  updateMcpBinding
} from '../mcpStatusTool'
import { isMcpToolbarActive } from '../mcpToolbarState'

const translations: Record<string, string> = {
  'settings.mcp.runtimeStatus.connected': 'Connected',
  'settings.mcp.runtimeStatus.connecting': 'Connecting',
  'settings.mcp.runtimeStatus.disabled': 'Disabled',
  'settings.mcp.runtimeStatus.error': 'Error',
  'library.config.tools.mode.auto.label': 'Auto',
  'library.config.tools.mode.disabled.label': 'Disabled',
  'library.config.tools.mode.manual.label': 'Manual',
  'agent.settings.tooling.mcp.toggle': 'Toggle MCP server',
  'common.save_failed': 'Save failed',
  'settings.quickPanel.mcp.disabled': 'MCP is disabled for this assistant',
  'settings.quickPanel.mcp.manageCurrentAgent': 'Manage current Agent MCP servers',
  'settings.quickPanel.mcp.manageCurrentAssistant': 'Manage current Assistant MCP servers',
  'settings.quickPanel.mcp.manageGlobal': 'Manage global MCP servers',
  'settings.quickPanel.scope.currentAgent': 'Current Agent',
  'settings.quickPanel.scope.currentAssistant': 'Current Assistant',
  'settings.quickPanel.scope.global': 'Global'
}

const t = ((key: string, fallback?: string) => translations[key] ?? fallback ?? key) as any

const server = (overrides: Partial<McpServer> & Pick<McpServer, 'id' | 'name' | 'isActive'>): McpServer => ({
  type: 'stdio',
  ...overrides
})

const status = (state: McpRuntimeStatus['state']): McpRuntimeStatus => ({
  state,
  lastCheckedAt: 1
})

function renderMcpRuntime(context: Record<string, unknown>) {
  return render(
    <McpStatusComposerRuntime
      context={
        {
          launcher: { registerLaunchers: mocks.registerLaunchers },
          t,
          ...context
        } as any
      }
    />
  )
}

function openLatestRegisteredPanel() {
  const launcher = mocks.registerLaunchers.mock.calls.at(-1)?.[0][0] as ComposerToolLauncher | undefined
  launcher?.action?.({ quickPanel: { open: mocks.open }, source: 'root-panel' } as any)
  return mocks.open.mock.calls.at(-1)?.[0].list as Array<{
    action?: (options: unknown) => void
    disabled?: boolean
    suffix?: { props: { 'aria-label'?: string; children?: { props?: { className?: string } }; role?: string } }
  }>
}

describe('mcpStatusTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agent = undefined
    mocks.agentIds = []
    mocks.mcpServers = []
    mocks.mcpServerOptions = []
    mocks.updateAgent.mockResolvedValue({})
    mocks.updateAssistant.mockResolvedValue({})
  })

  it('builds chat manual mode rows from all installed servers and marks assistant bindings', () => {
    const onToggleBinding = vi.fn()
    const items = buildMcpStatusItems({
      assistant: {
        settings: { mcpMode: 'manual' },
        mcpServerIds: ['active']
      } as Assistant,
      mcpServers: [
        server({ id: 'active', name: 'filesystem', isActive: true }),
        server({ id: 'inactive', name: 'search', isActive: false })
      ],
      mcpStatuses: { active: status('connecting'), inactive: status('connected') },
      canEditBindings: true,
      onToggleBinding,
      scope: TopicType.Chat,
      t
    })

    items[0].action?.({} as any)
    expect(onToggleBinding).toHaveBeenCalledWith('active', false)
  })

  it('builds session rows from all installed servers even when the current agent has no bindings', () => {
    const onToggleBinding = vi.fn()
    const items = buildMcpStatusItems({
      agent: { mcps: [] },
      mcpServers: [
        server({ id: 'active', name: 'filesystem', isActive: true }),
        server({ id: 'inactive', name: 'search', isActive: false })
      ],
      mcpStatuses: { active: status('error') },
      canEditBindings: true,
      onToggleBinding,
      scope: TopicType.Session,
      t
    })

    items[0].action?.({} as any)
    expect(onToggleBinding).toHaveBeenCalledWith('active', true)
  })

  it('updates only the assistant or agent MCP binding field for the active scope', async () => {
    const updateAssistant = vi.fn().mockResolvedValue({})
    const updateAgent = vi.fn().mockResolvedValue({})
    const assistant = {
      settings: { mcpMode: 'manual' },
      mcpServerIds: ['existing']
    } as Assistant

    await expect(
      updateMcpBinding({
        assistant,
        enabled: true,
        scope: TopicType.Chat,
        serverId: 'new-server',
        updateAgent,
        updateAssistant
      })
    ).resolves.toBe(true)
    expect(updateAssistant).toHaveBeenCalledWith({ mcpServerIds: ['existing', 'new-server'] })
    expect(updateAgent).not.toHaveBeenCalled()

    await expect(
      updateMcpBinding({
        agent: { mcps: ['existing', 'remove-me'] },
        enabled: false,
        scope: TopicType.Session,
        serverId: 'remove-me',
        updateAgent,
        updateAssistant
      })
    ).resolves.toBe(true)
    expect(updateAgent).toHaveBeenCalledWith({ mcps: ['existing'] })
    expect(updateAssistant).toHaveBeenCalledTimes(1)
  })

  it.each(['auto', 'disabled'] as const)('does not mutate chat bindings in %s mode', async (mcpMode) => {
    const updateAssistant = vi.fn().mockResolvedValue({})
    const updateAgent = vi.fn().mockResolvedValue({})

    await expect(
      updateMcpBinding({
        assistant: { settings: { mcpMode }, mcpServerIds: [] } as unknown as Assistant,
        enabled: true,
        scope: TopicType.Chat,
        serverId: 'server',
        updateAgent,
        updateAssistant
      })
    ).resolves.toBe(false)
    expect(updateAssistant).not.toHaveBeenCalled()
    expect(updateAgent).not.toHaveBeenCalled()
  })

  it('registers a root-panel-only launcher that opens a read-only MCP panel and clears typed query text', () => {
    const items = [server({ id: 'active', name: 'filesystem', isActive: true })].map((mcpServer) => ({
      id: mcpServer.id,
      label: mcpServer.name,
      icon: 'mcp'
    }))
    const launcher = createMcpStatusLauncher(items, t)
    const quickPanel = { open: vi.fn() }
    const inputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 4,
      getText: () => '/mcp',
      insertText: vi.fn()
    }

    launcher.action?.({
      quickPanel,
      inputAdapter,
      queryAnchor: 0,
      source: 'root-panel',
      triggerInfo: { type: 'input', position: 0, originalText: '/mcp' }
    } as any)

    expect(inputAdapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
  })

  // Catches #20198: toolbar consumers need a pure activation contract so the MCP shortcut
  // can highlight when tools are enabled without opening the status panel.
  it('reports MCP toolbar activation from assistant mode or agent bindings', () => {
    expect(
      isMcpToolbarActive({
        scope: TopicType.Chat,
        assistant: { settings: { mcpMode: 'disabled' }, mcpServerIds: [] }
      })
    ).toBe(false)
    expect(
      isMcpToolbarActive({
        scope: TopicType.Chat,
        assistant: { settings: { mcpMode: 'auto' }, mcpServerIds: [] }
      })
    ).toBe(true)
    expect(
      isMcpToolbarActive({
        scope: TopicType.Chat,
        assistant: { settings: { mcpMode: 'manual' }, mcpServerIds: [] }
      })
    ).toBe(false)
    expect(
      isMcpToolbarActive({
        scope: TopicType.Chat,
        assistant: { settings: { mcpMode: 'manual' }, mcpServerIds: ['server-1'] }
      })
    ).toBe(true)
    expect(isMcpToolbarActive({ scope: TopicType.Session, agent: { mcps: [] } })).toBe(false)
    expect(isMcpToolbarActive({ scope: TopicType.Session, agent: { mcps: ['server-1'] } })).toBe(true)
  })

  it('marks the MCP launcher active when the conversation has enabled MCP tools', () => {
    expect(createMcpStatusLauncher([], t, 'auto', false, undefined, true)).toMatchObject({ active: true })
    expect(createMcpStatusLauncher([], t, 'disabled', false, undefined, false)).toMatchObject({ active: false })
  })

  it('registers scoped MCP management actions alongside its launcher', async () => {
    renderMcpRuntime({
      assistant: { id: 'assistant-1', settings: { mcpMode: 'manual' }, mcpServerIds: [] },
      scope: TopicType.Chat
    })
    await waitFor(() => expect(mocks.registerLaunchers).toHaveBeenCalled())

    const footerActions = mocks.registerLaunchers.mock.calls.at(-1)?.[1] as Array<{
      id: string
      panelSymbol: string
      order: number
    }>
    expect(footerActions).toEqual([
      expect.objectContaining({ id: 'mcp-status:open-config', panelSymbol: 'mcp-status', order: 10 }),
      expect.objectContaining({ id: 'mcp-status:open-global-config', panelSymbol: 'mcp-status', order: 20 })
    ])
  })

  it('shows saving state and ignores rapid repeated binding toggles', async () => {
    let resolveUpdate: (value: unknown) => void = () => undefined
    mocks.updateAssistant.mockImplementationOnce(() => new Promise((resolve) => (resolveUpdate = resolve)))
    mocks.mcpServers = [server({ id: 'filesystem', name: 'filesystem', isActive: true })]
    const assistant = {
      id: 'assistant-1',
      settings: { mcpMode: 'manual' },
      mcpServerIds: []
    } as unknown as Assistant

    renderMcpRuntime({ assistant, scope: TopicType.Chat })
    await waitFor(() => expect(mocks.registerLaunchers).toHaveBeenCalled())

    let items: ReturnType<typeof openLatestRegisteredPanel> = []
    act(() => {
      items = openLatestRegisteredPanel()
    })
    act(() => {
      items[0].action?.({})
      items[0].action?.({})
    })

    expect(mocks.updateAssistant).toHaveBeenCalledTimes(1)
    expect(mocks.updateAssistant).toHaveBeenCalledWith({ mcpServerIds: ['filesystem'] })
    await waitFor(() => {
      const pendingItems = openLatestRegisteredPanel()
      expect(pendingItems[0]).toMatchObject({ disabled: true })
      expect(pendingItems[0].suffix?.props).toMatchObject({
        'aria-label': 'Loading...',
        role: 'status'
      })
    })

    await act(async () => resolveUpdate({}))
    await waitFor(() => {
      const settledItems = openLatestRegisteredPanel()
      expect(settledItems[0]).toMatchObject({ disabled: false })
    })
  })

  it('reports a failed binding update and keeps server-backed selection state', async () => {
    mocks.updateAssistant.mockRejectedValueOnce(new Error('Network down'))
    mocks.mcpServers = [server({ id: 'filesystem', name: 'filesystem', isActive: true })]
    const assistant = {
      id: 'assistant-1',
      settings: { mcpMode: 'manual' },
      mcpServerIds: []
    } as unknown as Assistant

    renderMcpRuntime({ assistant, scope: TopicType.Chat })
    await waitFor(() => expect(mocks.registerLaunchers).toHaveBeenCalled())

    act(() => {
      openLatestRegisteredPanel()[0].action?.({})
    })

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Save failed: Network down'))

    const settledItems = openLatestRegisteredPanel()
    expect(settledItems[0]).toMatchObject({ disabled: false })
  })

  it('resolves the MCP config target from the conversation scope', () => {
    expect(resolveMcpConfigTarget({ scope: TopicType.Session, agentId: 'agent-1' })).toEqual({
      kind: 'agent',
      id: 'agent-1',
      initialTab: 'tools.mcp'
    })
    expect(resolveMcpConfigTarget({ scope: TopicType.Chat, assistantId: 'assistant-1' })).toEqual({
      kind: 'assistant',
      id: 'assistant-1',
      initialTab: 'tools.mcp'
    })
    // Session ignores the assistant id and vice versa; missing id yields no target.
    expect(resolveMcpConfigTarget({ scope: TopicType.Session, assistantId: 'assistant-1' })).toBeNull()
    expect(resolveMcpConfigTarget({ scope: TopicType.Chat })).toBeNull()
  })

  it('builds an accessible MCP footer action that opens the edit dialog', () => {
    expect(buildMcpConfigFooterItem(null, t)).toBeNull()

    const target = { kind: 'agent', id: 'agent-1', initialTab: 'tools.mcp' } as const
    const footer = buildMcpConfigFooterItem(target, t)

    footer?.action?.({} as any)
    expect(editDialogMocks.openResourceEditDialog).toHaveBeenCalledWith(target)
  })

  it('opens the global MCP server settings from the global footer action', () => {
    const action = buildMcpGlobalConfigFooterItem(t)

    expect(action).toMatchObject({
      id: 'mcp-status:open-global-config',
      ariaLabel: 'Manage global MCP servers'
    })
    const globalIcon = action.icon
    expect(isValidElement(globalIcon) && globalIcon.type === Globe2).toBe(true)

    action.action({} as any)

    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/mcp/servers')
  })
})
