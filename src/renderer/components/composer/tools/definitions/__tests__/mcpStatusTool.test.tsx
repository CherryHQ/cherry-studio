import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { McpServer } from '@shared/data/types/mcpServer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({ agent: undefined })
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => ({})
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: [] })
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
  resolveMcpConfigTarget
} from '../mcpStatusTool'

const translations: Record<string, string> = {
  'settings.mcp.runtimeStatus.connected': 'Connected',
  'settings.mcp.runtimeStatus.connecting': 'Connecting',
  'settings.mcp.runtimeStatus.disabled': 'Disabled',
  'settings.mcp.runtimeStatus.error': 'Error',
  'library.config.tools.mode.auto.label': 'Auto',
  'library.config.tools.mode.disabled.label': 'Disabled',
  'library.config.tools.mode.manual.label': 'Manual',
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

describe('mcpStatusTool', () => {
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

  it('builds chat manual mode rows from assistant bindings and shows inactive servers as disabled', () => {
    const items = buildMcpStatusItems({
      assistant: {
        settings: { mcpMode: 'manual' },
        mcpServerIds: ['inactive', 'active']
      } as Assistant,
      mcpServers: [
        server({ id: 'active', name: 'filesystem', isActive: true }),
        server({ id: 'inactive', name: 'search', isActive: false })
      ],
      mcpStatuses: { active: status('connecting'), inactive: status('connected') },
      scope: TopicType.Chat,
      t
    })

    expect(items.map((item) => item.label)).toEqual(['search', 'filesystem'])
    expect(items[0]).toMatchObject({
      description: 'Disabled'
    })
    expect(items[0].suffix).toBeUndefined()
    expect(items[1]).toMatchObject({
      description: 'Connecting'
    })
    expect(items[1].suffix).toBeUndefined()
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

  it('builds session rows from the current agent bindings', () => {
    const items = buildMcpStatusItems({
      agent: { mcps: ['inactive', 'active'] },
      mcpServers: [
        server({ id: 'active', name: 'filesystem', isActive: true }),
        server({ id: 'inactive', name: 'search', isActive: false })
      ],
      mcpStatuses: { active: status('error') },
      scope: TopicType.Session,
      t
    })

    expect(items.map((item) => item.label)).toEqual(['search', 'filesystem'])
    expect(items[0]).toMatchObject({ description: 'Disabled' })
    expect(items[1]).toMatchObject({ description: 'Error' })
    expect(items[0].suffix).toBeUndefined()
    expect(items[1].suffix).toBeUndefined()
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
