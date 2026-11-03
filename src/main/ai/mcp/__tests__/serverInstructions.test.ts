import { describe, expect, it, vi } from 'vitest'

import type { McpServer } from '@shared/data/types/mcpServer'
import { MCP_SERVER_INSTRUCTIONS_MAX_CHARS, McpServerInstructionsSchema } from '@shared/types/mcp'

const { getInstructions, listTools } = vi.hoisted(() => ({
  getInstructions: vi.fn(),
  listTools: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  const get = mock.application.get.getMockImplementation()!
  mock.application.get.mockImplementation((name) =>
    name === 'McpRuntimeService'
      ? { getConnectedServerInstructions: getInstructions }
      : name === 'McpCatalogService'
        ? { listTools }
        : get(name)
  )
  return mock
})

const { projectServerInstructions, buildMcpInstructionsContext, buildFetchPreferenceContext } =
  await import('../serverInstructions')

describe('Cherry Fetch preference', () => {
  const server = { id: 'fetch-1', name: '@cherry/fetch', type: 'inMemory', isActive: true } as McpServer
  const tools = [
    { name: 'fetch_html', id: 'html' },
    { name: 'fetch_markdown', id: 'markdown' }
  ]

  it('only recommends available tools using the runtime names, with fallback and explicit-choice guidance', () => {
    listTools.mockReturnValue(tools)
    const selected = [{ ...server, disabledTools: ['fetch_html'] }]
    const text = buildFetchPreferenceContext(selected, (tool) => `runtime__${tool.name}`)!
    expect(text).toContain('runtime__fetch_markdown')
    expect(text).not.toContain('runtime__fetch_html')
    expect(text).toContain('unavailable, fails, or cannot meet')
    expect(text).toContain('explicit user choice')
    expect(buildFetchPreferenceContext(selected, () => undefined)).toBeUndefined()
  })

  it('does not recommend unmounted, inactive, cold, or merely same-named external servers', () => {
    listTools.mockReturnValue(tools)
    for (const row of [undefined, { ...server, isActive: false }, { ...server, type: 'stdio' }]) {
      expect(buildFetchPreferenceContext([row as McpServer | undefined], (tool) => tool.id)).toBeUndefined()
    }
    expect(buildFetchPreferenceContext([], (tool) => tool.id)).toBeUndefined()
    listTools.mockReturnValue([])
    expect(buildFetchPreferenceContext([server], (tool) => tool.id)).toBeUndefined()
  })
})

describe('server instruction context', () => {
  it('only includes selected connected servers once, with host-assigned source labels', () => {
    getInstructions.mockImplementation((id) =>
      id === 'docs' ? { serverId: id, serverName: 'Documents', text: 'Read the URI.', truncated: false } : undefined
    )
    const context = buildMcpInstructionsContext(['docs', 'offline', 'docs'])!
    expect(context).toContain('does not override user or host instructions')
    expect(JSON.parse(context.slice(context.indexOf('[{')))).toEqual([
      { serverId: 'docs', serverName: 'Documents', text: 'Read the URI.', truncated: false }
    ])
    expect(buildMcpInstructionsContext([])).toBeUndefined()
  })

  it('bounds remote instructions and marks truncated content instead of claiming it is complete', () => {
    const result = projectServerInstructions({ id: 'docs', name: 'Documents' }, 'a'.repeat(40_000))!
    expect(McpServerInstructionsSchema.parse(result)).toEqual(result)
    expect(result.text.length).toBe(MCP_SERVER_INSTRUCTIONS_MAX_CHARS)
    expect(result.text.endsWith('[Server instructions truncated]')).toBe(true)
    expect(result.truncated).toBe(true)
    expect(projectServerInstructions({ id: 'docs', name: 'Documents' }, 'Read the URI.')).toMatchObject({
      text: 'Read the URI.',
      truncated: false
    })
    expect(projectServerInstructions({ id: 'docs', name: 'Documents' }, '  ')).toBeUndefined()
  })
})
