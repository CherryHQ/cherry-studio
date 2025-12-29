import type { Tool } from '@types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

import { BaseService } from '../BaseService'

class TestBaseService extends BaseService {
  public normalize(allowedTools: string[] | undefined, tools: Tool[]): string[] | undefined {
    return this.normalizeAllowedTools(allowedTools, tools)
  }
}

const buildMcpTool = (id: string): Tool => ({
  id,
  name: id,
  type: 'mcp',
  description: 'test tool',
  requirePermissions: true
})

describe('BaseService.normalizeAllowedTools', () => {
  const service = new TestBaseService()

  it('returns undefined or empty inputs unchanged', () => {
    expect(service.normalize(undefined, [])).toBeUndefined()
    expect(service.normalize([], [])).toEqual([])
  })

  it('normalizes legacy MCP tool IDs and deduplicates entries', () => {
    const tools: Tool[] = [
      buildMcpTool('mcp__server-one__tool-one'),
      buildMcpTool('mcp__server-two__tool-two'),
      { id: 'custom_tool', name: 'custom_tool', type: 'custom' }
    ]

    const allowedTools = [
      'mcp_server-one_tool-one',
      'mcp__server-one__tool-one',
      'custom_tool',
      'mcp_server-two_tool-two'
    ]

    expect(service.normalize(allowedTools, tools)).toEqual([
      'mcp__server-one__tool-one',
      'custom_tool',
      'mcp__server-two__tool-two'
    ])
  })

  it('keeps legacy IDs when no matching MCP tool exists', () => {
    const tools: Tool[] = [buildMcpTool('mcp__server-one__tool-one')]

    const allowedTools = ['mcp_unknown_tool', 'mcp__server-one__tool-one']

    expect(service.normalize(allowedTools, tools)).toEqual(['mcp_unknown_tool', 'mcp__server-one__tool-one'])
  })

  it('returns allowed tools unchanged when no MCP tools are available', () => {
    const allowedTools = ['custom_tool', 'builtin_tool']
    const tools: Tool[] = [{ id: 'custom_tool', name: 'custom_tool', type: 'custom' }]

    expect(service.normalize(allowedTools, tools)).toEqual(allowedTools)
  })
})
