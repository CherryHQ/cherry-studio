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

function makeServer(id: string, overrides: Partial<McpServer> = {}): McpServer {
  return { id, name: `${id}-name`, isActive: true, ...overrides } as McpServer
}

function makeResource(serverId: string, uri: string): McpResource {
  return { serverId, serverName: `${serverId}-name`, uri, name: uri, mimeType: 'text/plain' }
}

function callExecute(
  entry: typeof listEntry,
  args: Record<string, unknown>,
  request: Record<string, unknown> = {}
): Promise<unknown> {
  const execute = entry.tool.execute as (args: unknown, options: ToolExecutionOptions) => Promise<unknown>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1', ...request }
  } as ToolExecutionOptions)
}

function callNeedsApproval(args: Record<string, unknown>, request: Record<string, unknown>): Promise<boolean> {
  const needsApproval = readEntry.tool.needsApproval as (
    args: unknown,
    options: ToolExecutionOptions
  ) => Promise<boolean>
  return needsApproval(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1', ...request }
  } as ToolExecutionOptions)
}

describe('mcp_resource_* entries', () => {
  it('declares the agreed namespace, defer and truncate policy', () => {
    expect(listEntry.name).toBe('mcp_resource_list')
    expect(readEntry.name).toBe('mcp_resource_read')
    expect(listEntry.namespace).toBe('mcp_resource')
    expect(readEntry.namespace).toBe('mcp_resource')
    // Read-style tool: its output must not be persisted and re-read through itself, and an
    // approval-gated entry must stay inline or its approval card never fires.
    expect(readEntry.truncatable).toBe(false)
    expect(readEntry.defer).toBe('never')
  })

  it('never asks a provider for constrained decoding (shared strict-schema compile budget)', () => {
    expect(listEntry.tool.strict).toBeFalsy()
    expect(readEntry.tool.strict).toBeFalsy()
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

    const result = (await callExecute(listEntry, {}, { assistant: makeAssistant() })) as { resources: unknown[] }

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

  it('cannot reach a server that connected after the request was built', async () => {
    listServers.mockReturnValue({ items: [makeServer('s1'), makeServer('late')] })
    getConnectedServerCapabilities.mockReturnValue({ resources: {} })
    listResources.mockResolvedValue([])

    await callExecute(listEntry, {}, { assistant: makeAssistant(), mcpResourceServerIds: new Set(['s1']) })

    expect(listResources).toHaveBeenCalledExactlyOnceWith('s1')
  })

  it('skips a server whose tools are disabled server-wide by the source policy', async () => {
    listServers.mockReturnValue({ items: [makeServer('s1', { disabledTools: ['mcp__s1Name__*'] })] })
    getConnectedServerCapabilities.mockReturnValue({ resources: {} })

    const result = (await callExecute(listEntry, {}, { assistant: makeAssistant() })) as { resources: unknown[] }

    expect(result.resources).toEqual([])
    expect(listResources).not.toHaveBeenCalled()
  })

  it('returns nothing when MCP is disabled for the assistant', async () => {
    listServers.mockReturnValue({ items: [makeServer('s1')] })
    getConnectedServerCapabilities.mockReturnValue({ resources: {} })

    const result = (await callExecute(
      listEntry,
      {},
      { assistant: makeAssistant({ settings: { mcpMode: 'disabled' } as Assistant['settings'] }) }
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

  it('reads through the named server, not whichever one happens to publish the uri', async () => {
    // Both servers publish the same uri: the serverName argument is what disambiguates them.
    listResources.mockImplementation(async (serverId) => [makeResource(serverId, 'file:///shared.md')])
    getResource.mockResolvedValue({ contents: [{ uri: 'file:///shared.md', text: 'hello', mimeType: 'text/plain' }] })

    const result = await callExecute(
      readEntry,
      { serverName: 's2-name', uri: 'file:///shared.md' },
      { assistant: makeAssistant() }
    )

    expect(getResource).toHaveBeenCalledExactlyOnceWith({
      serverId: 's2',
      uri: 'file:///shared.md',
      signal: undefined
    })
    expect(result).toMatchObject({ uri: 'file:///shared.md', serverName: 's2-name', text: 'hello', totalChars: 5 })
  })

  it('refuses a uri the named server does not publish, even when it is the only server in scope', async () => {
    listServers.mockReturnValue({ items: [makeServer('s1')] })
    listResources.mockResolvedValue([makeResource('s1', 'file:///a.md')])

    const result = (await callExecute(
      readEntry,
      { serverName: 's1-name', uri: 'file:///elsewhere.md' },
      { assistant: makeAssistant() }
    )) as { error: string }

    expect(result.error).toContain('file:///elsewhere.md')
    expect(getResource).not.toHaveBeenCalled()
  })

  it('refuses a server outside the frozen request scope', async () => {
    listResources.mockResolvedValue([makeResource('s2', 'file:///b.md')])

    const result = (await callExecute(
      readEntry,
      { serverName: 's2-name', uri: 'file:///b.md' },
      { assistant: makeAssistant(), mcpResourceServerIds: new Set(['s1']) }
    )) as { error: string }

    expect(result.error).toContain('s2-name')
    expect(getResource).not.toHaveBeenCalled()
  })

  it('caps a page at the request tool-output cap and reports the continuation', async () => {
    listResources.mockImplementation(async (serverId) => (serverId === 's1' ? [makeResource('s1', 'x://big')] : []))
    getResource.mockResolvedValue({ contents: [{ uri: 'x://big', text: 'abcdefghij', mimeType: 'text/plain' }] })

    const first = (await callExecute(
      readEntry,
      { serverName: 's1-name', uri: 'x://big' },
      { assistant: makeAssistant(), toolOutputCharCap: 4 }
    )) as { text: string; totalChars: number; nextOffset?: number }

    expect(first).toMatchObject({ text: 'abcd', totalChars: 10, nextOffset: 4 })

    const last = (await callExecute(
      readEntry,
      { serverName: 's1-name', uri: 'x://big', offset: 8 },
      { assistant: makeAssistant(), toolOutputCharCap: 4 }
    )) as { text: string; nextOffset?: number }

    expect(last.text).toBe('ij')
    expect(last.nextOffset).toBeUndefined()
  })

  it('propagates the request abort signal to the server read', async () => {
    const abortSignal = new AbortController().signal
    listResources.mockImplementation(async (serverId) => (serverId === 's1' ? [makeResource('s1', 'x://a')] : []))
    getResource.mockResolvedValue({ contents: [{ uri: 'x://a', text: 'hi' }] })

    await callExecute(readEntry, { serverName: 's1-name', uri: 'x://a' }, { assistant: makeAssistant(), abortSignal })

    expect(getResource).toHaveBeenCalledExactlyOnceWith({ serverId: 's1', uri: 'x://a', signal: abortSignal })
  })

  it('renders binary contents as a placeholder rather than dropping them', async () => {
    listResources.mockImplementation(async (serverId) => (serverId === 's1' ? [makeResource('s1', 'x://bin')] : []))
    getResource.mockResolvedValue({ contents: [{ uri: 'x://bin', blob: 'AAAA', mimeType: 'image/png' }] })

    const result = (await callExecute(
      readEntry,
      { serverName: 's1-name', uri: 'x://bin' },
      { assistant: makeAssistant() }
    )) as { text: string }

    expect(result.text).toContain('Binary resource: image/png')
  })

  it('prompts for approval when the server is wildcard-gated, and not otherwise', async () => {
    listServers.mockReturnValue({ items: [makeServer('s1')] })
    expect(await callNeedsApproval({}, { assistant: makeAssistant() })).toBe(false)

    listServers.mockReturnValue({ items: [makeServer('s1', { disabledAutoApproveTools: ['mcp__s1Name__*'] })] })
    expect(await callNeedsApproval({}, { assistant: makeAssistant() })).toBe(true)
  })
})
