/**
 * createAgent Tests
 * Verifies that createAgent resolves model via plugin pipeline and returns a ToolLoopAgent
 */

import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createMockLanguageModel, createMockProviderV3, mockProviderConfigs } from '@test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAgent } from '../createAgent'

// Mock extensionRegistry used by createExecutor
vi.mock('../../providers', () => ({
  extensionRegistry: {
    has: vi.fn(() => true),
    createProvider: vi.fn(),
    getModelResolver: vi.fn(() => undefined)
  }
}))

// Mock AI SDK - keep ToolLoopAgent real, mock wrapLanguageModel
vi.mock('ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    wrapLanguageModel: vi.fn((config: any) => ({
      ...config.model,
      _middlewareApplied: true,
      middleware: config.middleware
    }))
  }
})

describe('createAgent', () => {
  let mockLanguageModel: LanguageModelV3
  let mockProvider: any

  beforeEach(async () => {
    vi.clearAllMocks()

    mockLanguageModel = createMockLanguageModel({
      specificationVersion: 'v3',
      provider: 'openai',
      modelId: 'gpt-4'
    })

    mockProvider = createMockProviderV3({
      provider: 'openai',
      languageModel: vi.fn(() => mockLanguageModel)
    })

    const { extensionRegistry } = await import('../../providers')
    vi.mocked(extensionRegistry.createProvider).mockResolvedValue(mockProvider)
  })

  // ToolLoopAgent holds its settings for the whole loop and never enters the
  // per-request plugin pipeline, so a transformParams-only plugin (how
  // provider-native tools are injected) would otherwise be silently inert here.

  it('should throw when provider is not registered', async () => {
    const { extensionRegistry } = await import('../../providers')
    vi.mocked(extensionRegistry.has).mockReturnValue(false)

    await expect(
      createAgent({
        providerId: 'unknown-provider' as any,
        providerSettings: {},
        modelId: 'some-model',
        agentSettings: { tools: {} }
      })
    ).rejects.toThrow('not registered')
  })

  it('should throw ModelResolutionError when model cannot be resolved', async () => {
    // Provider that returns undefined for languageModel
    const brokenProvider = createMockProviderV3({
      provider: 'openai',
      languageModel: vi.fn(() => {
        throw new Error('Model not found')
      })
    })

    const { extensionRegistry } = await import('../../providers')
    vi.mocked(extensionRegistry.createProvider).mockResolvedValue(brokenProvider)

    await expect(
      createAgent({
        providerId: 'openai',
        providerSettings: mockProviderConfigs.openai,
        modelId: 'nonexistent-model',
        agentSettings: { tools: {} }
      })
    ).rejects.toThrow()
  })
})
