import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { getByIdMock, listServersMock, warmMock, listToolsMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  listServersMock: vi.fn(),
  warmMock: vi.fn(),
  listToolsMock: vi.fn()
}))
vi.mock('@data/services/AssistantService', () => ({ assistantDataService: { getById: getByIdMock } }))
vi.mock('@main/data/services/McpServerService', () => ({ mcpServerService: { list: listServersMock } }))
vi.mock('@application', () => ({
  application: { get: () => ({ warmToolsCache: warmMock, listTools: listToolsMock }) }
}))

import { getEffectiveMcpMode, resolveAssistantMcpToolIds } from '../resolveAssistantMcpTools'

const SERVER = { id: 'srv-1', name: '@cherry/filesystem', isActive: true }
const TOOLS = [
  { id: 'mcp__fs__read', name: 'read' },
  { id: 'mcp__fs__ls', name: 'ls' }
]

function assistant(overrides: Record<string, unknown> = {}) {
  return { id: 'a1', mcpServerIds: ['srv-1'], settings: {}, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  listServersMock.mockReturnValue({ items: [SERVER] })
  warmMock.mockResolvedValue(undefined)
  listToolsMock.mockReturnValue(TOOLS)
})

describe('resolveAssistantMcpToolIds', () => {
  it('warms the cache before listing so a cold catalog cannot yield a silent empty set', async () => {
    getByIdMock.mockReturnValue(assistant())
    // Cold until warmed — the pre-fix behavior returned [] here.
    listToolsMock.mockReturnValue([])
    warmMock.mockImplementation(async () => {
      listToolsMock.mockReturnValue(TOOLS)
    })

    const ids = await resolveAssistantMcpToolIds('a1')

    expect(warmMock).toHaveBeenCalledWith('srv-1')
    expect(warmMock.mock.invocationCallOrder[0]).toBeLessThan(listToolsMock.mock.invocationCallOrder.at(-1)!)
    expect(ids).toEqual(['mcp__fs__read', 'mcp__fs__ls'])
  })

  it('defaults a mode-less assistant to manual (linked servers only)', async () => {
    getByIdMock.mockReturnValue(assistant({ mcpServerIds: [] }))
    expect(await resolveAssistantMcpToolIds('a1')).toEqual([])
    expect(warmMock).not.toHaveBeenCalled()
  })

  it('explicit disabled resolves nothing without touching the catalog', async () => {
    getByIdMock.mockReturnValue(assistant({ settings: { mcpMode: 'disabled' } }))
    expect(await resolveAssistantMcpToolIds('a1')).toEqual([])
    expect(warmMock).not.toHaveBeenCalled()
  })

  it('explicit auto resolves all active servers', async () => {
    getByIdMock.mockReturnValue(assistant({ mcpServerIds: [], settings: { mcpMode: 'auto' } }))
    expect(await resolveAssistantMcpToolIds('a1')).toEqual(['mcp__fs__read', 'mcp__fs__ls'])
  })
})

describe('getEffectiveMcpMode', () => {
  it('uses the shared default (manual) when unset — regardless of linked servers', () => {
    expect(getEffectiveMcpMode(assistant() as never)).toBe('manual')
    expect(getEffectiveMcpMode(assistant({ mcpServerIds: [] }) as never)).toBe('manual')
    expect(getEffectiveMcpMode(assistant({ settings: { mcpMode: 'auto' } }) as never)).toBe('auto')
  })
})
