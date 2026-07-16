import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  warmToolsCache: vi.fn(),
  listTools: vi.fn(),
  findByIdOrName: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'McpCatalogService') return { warmToolsCache: mocks.warmToolsCache, listTools: mocks.listTools }
      if (name === 'McpRuntimeService') return { callTool: vi.fn() }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: mocks.findByIdOrName, getById: vi.fn() }
}))

import { buildMcpToolSet } from './mcpToolSet'

const server = { id: 'srv-1', name: 'files', isActive: true } as unknown as McpServer
const mcpTool = {
  id: 'mcp__files__search',
  name: 'search',
  serverId: 'srv-1',
  serverName: 'files',
  description: 'search files',
  inputSchema: { type: 'object', properties: {} }
} as unknown as McpTool

describe('buildMcpToolSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findByIdOrName.mockReturnValue(server)
    mocks.warmToolsCache.mockResolvedValue(undefined)
    mocks.listTools.mockReturnValue([mcpTool])
  })

  it('returns an empty set without touching services when no server is selected', async () => {
    await expect(buildMcpToolSet([])).resolves.toEqual({})
    expect(mocks.findByIdOrName).not.toHaveBeenCalled()
  })

  it('keeps the native mcp__<server>__<tool> ids', async () => {
    const tools = await buildMcpToolSet(['srv-1'])
    expect(Object.keys(tools)).toEqual(['mcp__files__search'])
    expect(tools['mcp__files__search'].description).toBe('search files')
  })

  it('skips unresolvable server references', async () => {
    mocks.findByIdOrName.mockReturnValue(undefined)
    await expect(buildMcpToolSet(['ghost'])).resolves.toEqual({})
    expect(mocks.warmToolsCache).not.toHaveBeenCalled()
  })

  it('a dead server neither hangs nor fails the build — cache-only tools still load', async () => {
    mocks.warmToolsCache.mockRejectedValue(new Error('connection refused'))
    const tools = await buildMcpToolSet(['srv-1'])
    expect(Object.keys(tools)).toEqual(['mcp__files__search'])
  })

  it('dedups a server selected by both id and name', async () => {
    const tools = await buildMcpToolSet(['srv-1', 'files'])
    expect(Object.keys(tools)).toEqual(['mcp__files__search'])
    expect(mocks.listTools).toHaveBeenCalledTimes(1)
  })
})
