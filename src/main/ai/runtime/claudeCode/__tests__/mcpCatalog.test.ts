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
  return mockApplicationFactory({ McpCatalogService: { listTools: mockListTools } })
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
})
