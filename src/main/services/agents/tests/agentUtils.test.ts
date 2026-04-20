import path from 'node:path'

import type { AgentType, Tool } from '@types'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModelField } from '../errors'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  return createNodeFsMock()
})

const mockMcpApiService = {
  getServerInfo: vi.fn()
}
vi.mock('@main/apiServer/services/mcp', () => ({
  getMcpApiService: vi.fn(() => mockMcpApiService)
}))

const mockValidateModelId = vi.fn()
vi.mock('@main/apiServer/utils', () => ({
  validateModelId: (...args: unknown[]) => mockValidateModelId(...args)
}))

import { normalizeAllowedTools, resolveAccessiblePaths, validateAgentModels } from '../agentUtils'
import { AgentModelValidationError } from '../errors'

const buildMcpTool = (id: string): Tool => ({
  id,
  name: id,
  type: 'mcp',
  description: 'test tool',
  requirePermissions: true
})

describe('normalizeAllowedTools', () => {
  it('returns undefined or empty inputs unchanged', () => {
    expect(normalizeAllowedTools(undefined, [])).toBeUndefined()
    expect(normalizeAllowedTools([], [])).toEqual([])
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

    expect(normalizeAllowedTools(allowedTools, tools, legacyIdMap)).toEqual([
      'mcp__server_one__tool_one',
      'custom_tool',
      'mcp__server_two__tool_two'
    ])
  })

  it('keeps legacy IDs when no matching MCP tool exists', () => {
    const tools: Tool[] = [buildMcpTool('mcp__server_one__tool_one')]
    const legacyIdMap = new Map<string, string>([['mcp__server-1__tool-one', 'mcp__server_one__tool_one']])

    const allowedTools = ['mcp__unknown__tool', 'mcp__server_one__tool_one']

    expect(normalizeAllowedTools(allowedTools, tools, legacyIdMap)).toEqual([
      'mcp__unknown__tool',
      'mcp__server_one__tool_one'
    ])
  })

  it('returns allowed tools unchanged when no MCP tools are available', () => {
    const allowedTools = ['custom_tool', 'builtin_tool']
    const tools: Tool[] = [{ id: 'custom_tool', name: 'custom_tool', type: 'custom' }]

    expect(normalizeAllowedTools(allowedTools, tools)).toEqual(allowedTools)
  })
})

describe('validateAgentModels', () => {
  it('throws error when regular provider is missing API key', async () => {
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider: { id: 'openai', apiKey: '' }
    })

    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'openai:gpt-4' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).rejects.toThrow(AgentModelValidationError)
  })

  it('does not throw for ollama provider without API key and sets placeholder', async () => {
    const provider = { id: 'ollama', apiKey: '' }
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider
    })

    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'ollama:llama3' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).resolves.not.toThrow()
    expect(provider.apiKey).toBe('ollama')
  })

  it('does not throw for lmstudio provider without API key and sets placeholder', async () => {
    const provider = { id: 'lmstudio', apiKey: '' }
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider
    })

    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'lmstudio:model' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).resolves.not.toThrow()
    expect(provider.apiKey).toBe('lmstudio')
  })

  it('does not modify API key when provider already has one', async () => {
    const provider = { id: 'openai', apiKey: 'sk-existing-key' }
    mockValidateModelId.mockResolvedValue({
      valid: true,
      provider
    })

    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'openai:gpt-4' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).resolves.not.toThrow()
    expect(provider.apiKey).toBe('sk-existing-key')
  })
})

describe('resolveAccessiblePaths', () => {
  const testId = 'agent_1234567890_abcdefghi'
  // Matches the stub in tests/main.setup.ts → application.getPath('feature.agents.workspaces')
  const defaultPath = path.join('/mock/feature.agents.workspaces', 'abcdefghi')

  it('assigns a default path when paths is undefined', () => {
    expect(resolveAccessiblePaths(undefined, testId)).toEqual([defaultPath])
  })

  it('assigns a default path when paths is empty array', () => {
    expect(resolveAccessiblePaths([], testId)).toEqual([defaultPath])
  })

  it('passes through provided paths unchanged', () => {
    expect(resolveAccessiblePaths(['/some/path'], testId)).toEqual([path.normalize('/some/path')])
  })
})
