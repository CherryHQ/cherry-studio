import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getByIdMock, listServersMock, warmMock, listToolsMock, warnMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  listServersMock: vi.fn(),
  warmMock: vi.fn(),
  listToolsMock: vi.fn(),
  warnMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: warnMock, info: vi.fn(), error: vi.fn() }) }
}))
vi.mock('@data/services/AssistantService', () => ({ assistantDataService: { getById: getByIdMock } }))
vi.mock('@main/data/services/McpServerService', () => ({ mcpServerService: { list: listServersMock } }))
vi.mock('@application', () => ({
  application: { get: () => ({ warmToolsCache: warmMock, listTools: listToolsMock }) }
}))

import { buildMcpWireToolId } from '@shared/ai/tools/mcpSourcePolicy'

import { getEffectiveMcpMode, resolveAssistantMcpToolIds, resolveMcpToolIds } from '../resolveAssistantMcpTools'

const SERVER = { id: 'srv-1', name: '@cherry/filesystem', isActive: true }
const TOOLS = [
  { id: 'identity-read', runtimeName: 'mcp__fs__read__runtime', name: 'read' },
  { id: 'identity-ls', runtimeName: 'mcp__fs__ls__runtime', name: 'ls' }
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
    expect(ids).toEqual(['identity-read', 'identity-ls'])
  })

  it('caps the warm wait: a hung warm does not block, degrades to the current cache, and warns', async () => {
    vi.useFakeTimers()
    try {
      getByIdMock.mockReturnValue(assistant())
      // Dead server: warm hangs on the connect (3-minute floor) and never settles.
      warmMock.mockReturnValue(new Promise<void>(() => {}))
      listToolsMock.mockReturnValue([])

      const resultPromise = resolveAssistantMcpToolIds('a1')
      await vi.advanceTimersByTimeAsync(10_000)

      expect(await resultPromise).toEqual([])
      expect(listToolsMock).toHaveBeenCalledWith('srv-1')
      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining('Timed out warming MCP tools cache'),
        expect.objectContaining({ serverId: 'srv-1' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not warn when the warm resolves within the cap', async () => {
    getByIdMock.mockReturnValue(assistant())

    expect(await resolveAssistantMcpToolIds('a1')).toEqual(['identity-read', 'identity-ls'])
    expect(warnMock).not.toHaveBeenCalled()
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
    expect(await resolveAssistantMcpToolIds('a1')).toEqual(['identity-read', 'identity-ls'])
  })
})

describe('getEffectiveMcpMode', () => {
  it('uses the shared default (manual) when unset — regardless of linked servers', () => {
    expect(getEffectiveMcpMode(assistant() as never)).toBe('manual')
    expect(getEffectiveMcpMode(assistant({ mcpServerIds: [] }) as never)).toBe('manual')
    expect(getEffectiveMcpMode(assistant({ settings: { mcpMode: 'auto' } }) as never)).toBe('auto')
  })
})

describe('resolveMcpToolIds', () => {
  it('resolves exact legacy ids and runtime names without widening selection', () => {
    expect(resolveMcpToolIds([buildMcpWireToolId(SERVER.name, 'read'), 'unknown'])).toEqual(['identity-read'])
    expect(resolveMcpToolIds(['mcp__fs__ls__runtime'])).toEqual(['identity-ls'])
  })
})
