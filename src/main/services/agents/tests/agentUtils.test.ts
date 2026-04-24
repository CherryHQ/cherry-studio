import path from 'node:path'

import type { AgentType } from '@types'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModelField } from '../errors'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  return createNodeFsMock()
})

const mockGetByProviderId = vi.fn()
vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: (...args: unknown[]) => mockGetByProviderId(...args)
  }
}))

import { resolveAccessiblePaths, validateAgentModels } from '../agentUtils'
import { AgentModelValidationError } from '../errors'

describe('validateAgentModels', () => {
  it('throws when model string is not in UniqueModelId format', async () => {
    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'gpt-4' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).rejects.toThrow(AgentModelValidationError)
  })

  it('throws when provider cannot be resolved', async () => {
    mockGetByProviderId.mockResolvedValue(null)

    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'unknown::gpt-4' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).rejects.toThrow(AgentModelValidationError)
  })

  it('throws when regular provider has no enabled API keys', async () => {
    mockGetByProviderId.mockResolvedValue({ id: 'openai', apiKeys: [{ id: 'k1', isEnabled: false }] })

    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'openai::gpt-4' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).rejects.toThrow(AgentModelValidationError)
  })

  it('does not throw for ollama provider without API key (local provider exempt)', async () => {
    mockGetByProviderId.mockResolvedValue({ id: 'ollama', apiKeys: [] })

    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'ollama::llama3' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).resolves.not.toThrow()
  })

  it('does not throw for lmstudio provider without API key (local provider exempt)', async () => {
    mockGetByProviderId.mockResolvedValue({ id: 'lmstudio', apiKeys: [] })

    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'lmstudio::model' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).resolves.not.toThrow()
  })

  it('passes when provider has an enabled API key', async () => {
    mockGetByProviderId.mockResolvedValue({ id: 'openai', apiKeys: [{ id: 'k1', isEnabled: true }] })

    await expect(
      validateAgentModels(
        'claude-code' as AgentType,
        { model: 'openai::gpt-4' } as Partial<Record<AgentModelField, string | undefined>>
      )
    ).resolves.not.toThrow()
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
