/**
 * Regression: tool display metadata must be authoritative under the same record keys the
 * runtime allocates. Two mounted servers sharing a configured name (`mcp_server.name` is not
 * unique) must not let the second server's compatibility aliases overwrite the first one's
 * runtime tool identity — streamAdapter resolves `state.name` (`mcp__<key>__<tool>`) first and
 * stamps the result onto calls and persisted provenance.
 */

import type * as NodeFs from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import type * as KnowledgeLookup from '@main/ai/tools/knowledgeLookup'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'

const { mockFindByIdOrName, mockListTools } = vi.hoisted(() => ({
  mockFindByIdOrName: vi.fn(),
  mockListTools: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof NodeFs
  return {
    ...actual,
    default: actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(),
      realpath: vi.fn()
    }
  }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  return {
    ...module,
    application: {
      ...module.application,
      get: (name: string) =>
        name === 'McpCatalogService' ? { listTools: mockListTools } : module.application.get(name)
    }
  }
})

vi.mock('@main/utils/file', () => ({
  getPathStatus: vi.fn()
}))

vi.mock('@main/ai/agents/agentDataDirectory', () => ({
  ensureAgentDataDirectory: vi.fn(),
  ensureAgentStorageDirectory: vi.fn()
}))

vi.mock('@main/i18n', () => ({
  getAppLanguage: vi.fn(() => 'en-US'),
  t: vi.fn((key: string, vars?: { path?: string }) => `${key}:${vars?.path ?? ''}`)
}))

vi.mock('@main/ai/mcp/servers/assistant', () => ({
  createAssistantServer: vi.fn()
}))

vi.mock('@main/ai/mcp/servers/AssistantFileToolsServer', () => ({
  createAssistantFileToolsServer: vi.fn()
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { findBySessionId: vi.fn(() => null), listChannels: vi.fn().mockResolvedValue([]) }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: vi.fn() }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: mockFindByIdOrName }
}))

vi.mock('@main/ai/mcp/createMcpBridgeServer', () => ({
  createMcpBridgeServer: vi.fn(() => ({}))
}))

vi.mock('@main/ai/tools/knowledgeLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof KnowledgeLookup>()),
  listOrOutlineKnowledge: vi.fn()
}))

const { buildMcpToolMetadata } = await import('../mcpCatalog')

const server = (id: string, name: string): McpServer => ({ id, name }) as McpServer
const tool = (id: string, name: string): McpTool => ({ id, name, description: `${name} desc` }) as unknown as McpTool

describe('buildMcpToolMetadata', () => {
  it('keeps the name-keyed runtime identity of the server that actually registered it', async () => {
    // Both servers are configured as `docs`; the allocator gives A the configured name and
    // B its UUID (see resolveMountedAgentMcpServers). A's runtime tool name is
    // `mcp__docs__run`, so B's `mcp__docs__run` compatibility alias must not replace A's
    // metadata there.
    const servers = new Map([
      ['id-a', server('id-a', 'docs')],
      ['id-b', server('id-b', 'docs')]
    ])
    mockFindByIdOrName.mockImplementation((idOrName: string) => servers.get(idOrName))
    mockListTools.mockImplementation((serverId: string) => [tool(`${serverId}-run`, 'run')])

    const metadata = await buildMcpToolMetadata({ id: 'agent-1', mcps: ['id-a', 'id-b'] } as unknown as AgentEntity)

    expect(metadata?.['mcp__docs__run']).toMatchObject({ serverId: 'id-a', name: 'run' })
    // B's own identity is its UUID key, and every uuid-form lookup still resolves.
    expect(metadata?.['mcp__id-b__run']).toMatchObject({ serverId: 'id-b', name: 'run' })
    expect(metadata?.['mcp__id-a__run']).toMatchObject({ serverId: 'id-a', name: 'run' })
  })

  it('registers every exact runtime tool name before adding camelized aliases', async () => {
    // One server listing `search_docs` before `searchDocs`: the first tool's camelized alias
    // flattens onto the second tool's exact runtime name, so the exact entry must be claimed
    // first — otherwise `searchDocs` calls display `search_docs` metadata.
    const servers = new Map([['id-a', server('id-a', 'docs')]])
    mockFindByIdOrName.mockImplementation((idOrName: string) => servers.get(idOrName))
    mockListTools.mockImplementation(() => [tool('id-a-1', 'search_docs'), tool('id-a-2', 'searchDocs')])

    const metadata = await buildMcpToolMetadata({ id: 'agent-1', mcps: ['id-a'] } as unknown as AgentEntity)

    expect(metadata?.['mcp__docs__searchDocs']).toMatchObject({ serverId: 'id-a', name: 'searchDocs' })
    expect(metadata?.['mcp__docs__search_docs']).toMatchObject({ serverId: 'id-a', name: 'search_docs' })
  })

  it('keeps metadata under the running connection allocation across mount changes', async () => {
    // A and B are both configured as `docs`; the live connection binds A to the configured name
    // and B to its UUID. Removing A from the agent mid-turn and refreshing B's tool cache must
    // not re-allocate the freed `docs` key to B: the live connection still executes
    // `mcp__docs__run` against A until the deferred rebuild, so the refresh must attribute it
    // to A under the frozen allocation.
    const servers = new Map([
      ['id-a', server('id-a', 'docs')],
      ['id-b', server('id-b', 'docs')]
    ])
    mockFindByIdOrName.mockImplementation((idOrName: string) => servers.get(idOrName))
    mockListTools.mockImplementation((serverId: string) => [tool(`${serverId}-run`, 'run')])

    const metadata = await buildMcpToolMetadata({ id: 'agent-1', mcps: ['id-b'] } as unknown as AgentEntity, {
      serverAllocation: new Map([
        ['id-a', 'docs'],
        ['id-b', 'id-b']
      ])
    })

    expect(metadata?.['mcp__docs__run']).toMatchObject({ serverId: 'id-a', name: 'run' })
    expect(metadata?.['mcp__id-b__run']).toMatchObject({ serverId: 'id-b', name: 'run' })
  })
})
