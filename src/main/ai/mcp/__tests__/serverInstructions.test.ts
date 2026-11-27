import { describe, expect, it, vi } from 'vitest'

import { MCP_SERVER_INSTRUCTIONS_MAX_CHARS, McpServerInstructionsSchema } from '@shared/types/mcp'

const { getInstructions } = vi.hoisted(() => ({ getInstructions: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  const get = mock.application.get.getMockImplementation()!
  mock.application.get.mockImplementation((name) =>
    name === 'McpRuntimeService' ? { getConnectedServerInstructions: getInstructions } : get(name)
  )
  return mock
})

const { projectServerInstructions, buildMcpInstructionsContext } = await import('../serverInstructions')

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
