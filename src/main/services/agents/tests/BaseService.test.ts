import type { AgentType, Tool } from '@types'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModelField } from '../errors'

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

const mockValidateModelId = vi.fn()
vi.mock('@main/apiServer/utils', () => ({
  validateModelId: (...args: unknown[]) => mockValidateModelId(...args)
}))

import { BaseService } from '../BaseService'
import { AgentModelValidationError } from '../errors'

class TestBaseService extends BaseService {
  public normalize(
    allowedTools: string[] | undefined,
    tools: Tool[],
    legacyIdMap?: Map<string, string>
  ): string[] | undefined {
    return this.normalizeAllowedTools(allowedTools, tools, legacyIdMap)
  }

  public async validateModels(
    agentType: AgentType,
    models: Partial<Record<AgentModelField, string | undefined>>
  ): Promise<void> {
    return this.validateAgentModels(agentType, models)
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
      buildMcpTool('mcp__server_one__tool_one'),
      buildMcpTool('mcp__server_two__tool_two'),
      { id: 'custom_tool', name: 'custom_tool', type: 'custom' }
    ]

    const legacyIdMap = new Map<string, string>([
      ['mcp__server-1__tool-one', 'mcp__server_one__tool_one'],
      ['mcp_server-1_tool-one', 'mcp__server_one__tool_one'],
      ['mcp__server-2__tool-two', 'mcp__server_two__tool_two']
    ])

    const allowedTools = [
      'mcp__server-1__tool-one',
      'mcp_server-1_tool-one',
      'mcp_server_one_tool_one',
      'mcp__server_one__tool_one',
      'custom_tool',
      'mcp__server_two__tool_two',
      'mcp_server_two_tool_two',
      'mcp__server-2__tool-two'
    ]

    expect(service.normalize(allowedTools, tools, legacyIdMap)).toEqual([
      'mcp__server_one__tool_one',
      'custom_tool',
      'mcp__server_two__tool_two'
    ])
  })

  it('keeps legacy IDs when no matching MCP tool exists', () => {
    const tools: Tool[] = [buildMcpTool('mcp__server_one__tool_one')]
    const legacyIdMap = new Map<string, string>([['mcp__server-1__tool-one', 'mcp__server_one__tool_one']])

    const allowedTools = ['mcp__unknown__tool', 'mcp__server_one__tool_one']

    expect(service.normalize(allowedTools, tools, legacyIdMap)).toEqual([
      'mcp__unknown__tool',
      'mcp__server_one__tool_one'
    ])
  })

  it('returns allowed tools unchanged when no MCP tools are available', () => {
    const allowedTools = ['custom_tool', 'builtin_tool']
    const tools: Tool[] = [{ id: 'custom_tool', name: 'custom_tool', type: 'custom' }]

    expect(service.normalize(allowedTools, tools)).toEqual(allowedTools)
  })
})

describe('BaseService.validateAgentModels', () => {
  const service = new TestBaseService()

  it('throws error when regular provider is missing API key', async () => {
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider: { id: 'openai', apiKey: '' }
    })

    await expect(service.validateModels('claude-code', { model: 'openai:gpt-4' })).rejects.toThrow(
      AgentModelValidationError
    )
  })

  it('does not throw for ollama provider without API key and sets placeholder', async () => {
    const provider = { id: 'ollama', apiKey: '' }
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider
    })

    await expect(service.validateModels('claude-code', { model: 'ollama:llama3' })).resolves.not.toThrow()
    expect(provider.apiKey).toBe('ollama')
  })

  it('does not throw for lmstudio provider without API key and sets placeholder', async () => {
    const provider = { id: 'lmstudio', apiKey: '' }
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider
    })

    await expect(service.validateModels('claude-code', { model: 'lmstudio:model' })).resolves.not.toThrow()
    expect(provider.apiKey).toBe('lmstudio')
  })

  it('does not modify API key when provider already has one', async () => {
    const provider = { id: 'openai', apiKey: 'sk-existing-key' }
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider
    })

    await expect(service.validateModels('claude-code', { model: 'openai:gpt-4' })).resolves.not.toThrow()
    expect(provider.apiKey).toBe('sk-existing-key')
  })
})
