import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { McpServer } from '@shared/data/types/mcpServer'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agent: undefined as { mcps?: string[] } | undefined,
  loggerError: vi.fn(),
  mcpServers: [] as McpServer[],
  open: vi.fn(),
  registerLaunchers: vi.fn<(launchers: unknown[]) => () => void>(() => () => undefined),
  toastError: vi.fn(),
  updateAgent: vi.fn(),
  updateAssistant: vi.fn(),
  updateList: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({ agent: mocks.agent })
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => ({})
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: mocks.mcpServers })
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

const editDialogMocks = vi.hoisted(() => ({ openResourceEditDialog: vi.fn() }))
vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
  openResourceEditDialog: editDialogMocks.openResourceEditDialog
}))

import type { Assistant } from '@renderer/types/assistant'

import { TopicType } from '../../types'
import {
  buildMcpConfigFooterItem,
  buildMcpStatusItems,
  createMcpStatusLauncher,
  McpStatusComposerRuntime,
  resolveMcpConfigTarget,
  updateMcpBinding
} from '../mcpStatusTool'

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
  'settings.quickPanel.mcp.disabled': 'MCP is disabled for this assistant'
}

const t = ((key: string, fallback?: string) => translations[key] ?? fallback ?? key) as any

const server = (overrides: Partial<McpServer> & Pick<McpServer, 'id' | 'name' | 'isActive'>): McpServer =>
  ({
    type: 'stdio',
    ...overrides
  }) as McpServer

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
    suffix?: { props: { checked?: boolean; disabled?: boolean; loading?: boolean } }
  }>
}

describe('mcpStatusTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agent = undefined
    mocks.mcpServers = []
    mocks.updateAgent.mockResolvedValue({})
    mocks.updateAssistant.mockResolvedValue({})
  })

  it('builds chat auto mode rows from active servers only', () => {
    const items = buildMcpStatusItems({
      assistant: {
        settings: { mcpMode: 'auto' },
        mcpServerIds: ['manual-only']
      } as Assistant,
      mcpServers: [
        server({ id: 'active', name: 'filesystem', isActive: true }),
        server({ id: 'inactive', name: 'search', isActive: false })
      ],
      mcpStatuses: { active: status('connected') },
      scope: TopicType.Chat,
      t
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      label: 'filesystem',
      description: 'Connected'
    })
    expect(items[0].suffix).toBeUndefined()
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

    expect(items.map((item) => item.label)).toEqual(['filesystem', 'search'])
    expect(items[0]).toMatchObject({
      description: 'Connecting',
      disabled: false,
      isSelected: true,
      keepOpenOnAction: true
    })
    expect(items[1]).toMatchObject({
      description: 'Disabled',
      disabled: true,
      isSelected: false
    })
    expect(items[0].suffix).toEqual(expect.objectContaining({ props: expect.objectContaining({ checked: true }) }))
    expect(items[1].suffix).toEqual(
      expect.objectContaining({ props: expect.objectContaining({ checked: false, disabled: true }) })
    )

    items[0].action?.({} as any)
    expect(onToggleBinding).toHaveBeenCalledWith('active', false)
  })

  it('builds a chat disabled empty state', () => {
    const items = buildMcpStatusItems({
      assistant: {
        settings: { mcpMode: 'disabled' },
        mcpServerIds: ['active']
      } as Assistant,
      mcpServers: [server({ id: 'active', name: 'filesystem', isActive: true })],
      mcpStatuses: {},
      scope: TopicType.Chat,
      t
    })

    expect(items).toEqual([expect.objectContaining({ label: 'MCP is disabled for this assistant', disabled: true })])
  })

  it('does not show the assistant MCP mode on chat empty states', () => {
    const autoItems = buildMcpStatusItems({
      assistant: {
        settings: { mcpMode: 'auto' },
        mcpServerIds: [] as string[]
      } as Assistant,
      mcpServers: [],
      mcpStatuses: {},
      scope: TopicType.Chat,
      t
    })
    expect(autoItems[0].description).toBeUndefined()

    const manualItems = buildMcpStatusItems({
      assistant: {
        settings: { mcpMode: 'manual' },
        mcpServerIds: [] as string[]
      } as Assistant,
      mcpServers: [],
      mcpStatuses: {},
      scope: TopicType.Chat,
      t
    })
    expect(manualItems[0].description).toBeUndefined()
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

    expect(items.map((item) => item.label)).toEqual(['filesystem', 'search'])
    expect(items[0]).toMatchObject({ description: 'Error', disabled: false, isSelected: false })
    expect(items[1]).toMatchObject({ description: 'Disabled', disabled: true, isSelected: false })

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

    expect(launcher).toMatchObject({
      id: 'mcp-status',
      sources: ['root-panel'],
      order: 50
    })

    launcher.action?.({
      quickPanel,
      inputAdapter,
      queryAnchor: 0,
      source: 'root-panel',
      triggerInfo: { type: 'input', position: 0, originalText: '/mcp' }
    } as any)

    expect(inputAdapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(quickPanel.open).toHaveBeenCalledWith(
      expect.objectContaining({
        list: items,
        readOnly: true,
        symbol: ComposerPanelSymbol.McpStatus,
        title: 'MCP'
      })
    )
  })

  it('opens manual binding panels as interactive', () => {
    const quickPanel = { open: vi.fn() }

    createMcpStatusLauncher([], t, 'manual', true).action?.({ quickPanel, source: 'root-panel' } as any)

    expect(quickPanel.open).toHaveBeenCalledWith(expect.objectContaining({ readOnly: false }))
  })

  it('shows assistant MCP mode in the details panel title', () => {
    const items = [{ id: 'active', label: 'filesystem', icon: 'mcp' }]
    const quickPanel = { open: vi.fn() }

    createMcpStatusLauncher(items, t, 'auto').action?.({
      quickPanel,
      source: 'root-panel'
    } as any)

    expect(quickPanel.open).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'MCP / Auto'
      })
    )

    vi.mocked(quickPanel.open).mockClear()

    createMcpStatusLauncher(items, t, 'manual').action?.({
      quickPanel,
      source: 'root-panel'
    } as any)

    expect(quickPanel.open).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'MCP / Manual'
      })
    )
  })

  it('keeps the MCP launcher openable when disabled so the config entry stays reachable', () => {
    const footer = buildMcpConfigFooterItem({ kind: 'assistant', id: 'a1', initialTab: 'tools.mcp' }, t)!
    const launcher = createMcpStatusLauncher([footer], t, 'disabled')

    expect(launcher).toMatchObject({ id: 'mcp-status', description: 'Disabled' })
    expect(launcher.disabled).toBeFalsy()
    expect(launcher.action).toEqual(expect.any(Function))

    const quickPanel = { open: vi.fn() }
    launcher.action?.({ quickPanel } as any)
    expect(quickPanel.open).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true, list: [footer] }))
  })

  it('shows saving state and ignores rapid repeated binding toggles', async () => {
    let resolveUpdate: (value: unknown) => void = () => undefined
    mocks.updateAssistant.mockImplementationOnce(
      () => new Promise((resolve) => (resolveUpdate = resolve as (value: unknown) => void))
    )
    mocks.mcpServers = [server({ id: 'filesystem', name: 'filesystem', isActive: true })]
    const assistant = {
      id: 'assistant-1',
      settings: { mcpMode: 'manual' },
      mcpServerIds: []
    } as unknown as Assistant

    renderMcpRuntime({ assistant, scope: TopicType.Chat })
    await waitFor(() => expect(mocks.registerLaunchers).toHaveBeenCalled())

    const items = openLatestRegisteredPanel()
    act(() => {
      items[0].action?.({})
      items[0].action?.({})
    })

    expect(mocks.updateAssistant).toHaveBeenCalledTimes(1)
    expect(mocks.updateAssistant).toHaveBeenCalledWith({ mcpServerIds: ['filesystem'] })
    await waitFor(() => {
      const pendingItems = openLatestRegisteredPanel()
      expect(pendingItems[0]).toMatchObject({ disabled: true })
      expect(pendingItems[0].suffix?.props).toMatchObject({ checked: false, disabled: true, loading: true })
    })

    await act(async () => resolveUpdate({}))
    await waitFor(() => {
      const settledItems = openLatestRegisteredPanel()
      expect(settledItems[0]).toMatchObject({ disabled: false })
      expect(settledItems[0].suffix?.props).toMatchObject({ checked: false, disabled: false, loading: false })
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
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to update MCP binding from the composer',
      expect.any(Error),
      expect.objectContaining({ scope: TopicType.Chat, serverId: 'filesystem' })
    )

    const settledItems = openLatestRegisteredPanel()
    expect(settledItems[0]).toMatchObject({ disabled: false })
    expect(settledItems[0].suffix?.props).toMatchObject({ checked: false, loading: false })
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

  it('builds a pinned MCP config footer that opens the edit dialog', () => {
    expect(buildMcpConfigFooterItem(null, t)).toBeNull()

    const target = { kind: 'agent', id: 'agent-1', initialTab: 'tools.mcp' } as const
    const footer = buildMcpConfigFooterItem(target, t)
    expect(footer).toMatchObject({ id: 'mcp-status:open-config', fixedToBottom: true })

    footer?.action?.({} as any)
    expect(editDialogMocks.openResourceEditDialog).toHaveBeenCalledWith(target)
  })
})
