import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Assistant } from '@shared/data/types/assistant'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpResource } from '@shared/types/mcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listResources = vi.fn<(serverId: string) => Promise<McpResource[]>>()
const getResource = vi.fn()
const getConnectedServerCapabilities = vi.fn<(serverId: string) => Record<string, unknown> | undefined>()

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'McpCatalogService') return { listResources }
      if (name === 'McpRuntimeService') return { getResource, getConnectedServerCapabilities }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

const listServers = vi.fn<() => { items: McpServer[] }>()
vi.mock('@main/data/services/McpServerService', () => ({
  mcpServerService: { list: () => listServers() }
}))

vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: { getById: () => null }
}))

import { createMcpResourceListToolEntry } from '../McpResourceListTool'
import { createMcpResourceReadToolEntry } from '../McpResourceReadTool'

const listEntry = createMcpResourceListToolEntry()
const readEntry = createMcpResourceReadToolEntry()

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return { id: 'assistant-1', mcpServerIds: [], settings: { mcpMode: 'auto' }, ...overrides } as Assistant
}

function makeServer(id: string): McpServer {
  return { id, name: `${id}-name`, isActive: true } as McpServer
}

function makeResource(serverId: string, uri: string): McpResource {
  return { serverId, serverName: `${serverId}-name`, uri, name: uri, mimeType: 'text/plain' }
}

function callExecute(entry: typeof listEntry, args: Record<string, unknown>, assistant?: Assistant): Promise<unknown> {
  const execute = entry.tool.execute as (args: unknown, options: ToolExecutionOptions) => Promise<unknown>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1', assistant }
  } as ToolExecutionOptions)
}

describe('mcp_resource_* entries', () => {
  it('declares the agreed namespace, defer and truncate policy', () => {
    expect(listEntry.name).toBe('mcp_resource_list')
    expect(readEntry.name).toBe('mcp_resource_read')
    expect(listEntry.namespace).toBe('mcp_resource')
    expect(readEntry.namespace).toBe('mcp_resource')
    expect(listEntry.defer).toBe('auto')
    // Read-style tool: its output must not be persisted and re-read through itself.
    expect(readEntry.truncatable).toBe(false)
  })

  it('is exposed only when an in-scope server declared the resources capability', () => {
    const scope = { mcpToolIds: new Set<string>() }
    expect(listEntry.applies?.({ ...scope, mcpResourceServerIds: new Set() })).toBe(false)
    expect(readEntry.applies?.({ ...scope, mcpResourceServerIds: new Set() })).toBe(false)
    expect(listEntry.applies?.(scope)).toBe(false)
    expect(listEntry.applies?.({ ...scope, mcpResourceServerIds: new Set(['s1']) })).toBe(true)
    expect(readEntry.applies?.({ ...scope, mcpResourceServerIds: new Set(['s1']) })).toBe(true)
  })
})

describe('mcp_resource_list', () => {
  beforeEach(() => {
    listResources.mockReset()
    getResource.mockReset()
    getConnectedServerCapabilities.mockReset()
    listServers.mockReset()
  })

  it('lists resources of resource-capable servers only', async () => {
    listServers.mockReturnValue({ items: [makeServer('s1'), makeServer('s2')] })
    getConnectedServerCapabilities.mockImplementation((id) => (id === 's1' ? { resources: {} } : { tools: {} }))
    listResources.mockResolvedValue([makeResource('s1', 'file:///a.md')])

    const result = (await callExecute(listEntry, {}, makeAssistant())) as { resources: unknown[] }

    expect(listResources).toHaveBeenCalledExactlyOnceWith('s1')
    expect(result.resources).toEqual([
      {
        serverName: 's1-name',
        uri: 'file:///a.md',
        name: 'file:///a.md',
        description: undefined,
        mimeType: 'text/plain'
      }
    ])
  })

  it('returns nothing when MCP is disabled for the assistant', async () => {
    listServers.mockReturnValue({ items: [makeServer('s1')] })
    getConnectedServerCapabilities.mockReturnValue({ resources: {} })

    const result = (await callExecute(
      listEntry,
      {},
      makeAssistant({ settings: { mcpMode: 'disabled' } as Assistant['settings'] })
    )) as { resources: unknown[] }

    expect(result.resources).toEqual([])
    expect(listResources).not.toHaveBeenCalled()
  })
})

describe('mcp_resource_read', () => {
  beforeEach(() => {
    listResources.mockReset()
    getResource.mockReset()
    getConnectedServerCapabilities.mockReset()
    listServers.mockReset()
    listServers.mockReturnValue({ items: [makeServer('s1'), makeServer('s2')] })
    getConnectedServerCapabilities.mockReturnValue({ resources: {} })
  })

  it('reads through the server that publishes the uri', async () => {
    listResources.mockImplementation(async (serverId) =>
      serverId === 's2' ? [makeResource('s2', 'file:///b.md')] : [makeResource('s1', 'file:///a.md')]
    )
    getResource.mockResolvedValue({ contents: [{ uri: 'file:///b.md', text: 'hello', mimeType: 'text/plain' }] })

    const result = await callExecute(readEntry, { uri: 'file:///b.md' }, makeAssistant())

    expect(getResource).toHaveBeenCalledExactlyOnceWith({ serverId: 's2', uri: 'file:///b.md' })
    expect(result).toEqual({ uri: 'file:///b.md', serverName: 's2-name', mimeType: 'text/plain', text: 'hello' })
  })

  it('refuses a uri no in-scope server publishes', async () => {
    listResources.mockResolvedValue([makeResource('s1', 'file:///a.md')])

    const result = (await callExecute(readEntry, { uri: 'file:///elsewhere.md' }, makeAssistant())) as {
      error: string
    }

    expect(result.error).toContain('file:///elsewhere.md')
    expect(getResource).not.toHaveBeenCalled()
  })

  it('renders binary contents as a placeholder rather than dropping them', async () => {
    listResources.mockImplementation(async (serverId) => (serverId === 's1' ? [makeResource('s1', 'x://bin')] : []))
    getResource.mockResolvedValue({ contents: [{ uri: 'x://bin', blob: 'AAAA', mimeType: 'image/png' }] })

    const result = (await callExecute(readEntry, { uri: 'x://bin' }, makeAssistant())) as { text: string }

    expect(result.text).toContain('Binary resource: image/png')
  })
})
