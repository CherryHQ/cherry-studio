/**
 * createAgent Tests
 * Verifies that createAgent resolves model via plugin pipeline and returns a ToolLoopAgent
 */

import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createMockLanguageModel, createMockProviderV3, mockProviderConfigs } from '@test-utils'
import { ToolLoopAgent } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { definePlugin } from '../../plugins'
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

  it('should return a ToolLoopAgent instance', async () => {
    const agent = await createAgent({
      providerId: 'openai',
      providerSettings: mockProviderConfigs.openai,
      modelId: 'gpt-4',
      agentSettings: {
        tools: {}
      }
    })

    expect(agent).toBeInstanceOf(ToolLoopAgent)
  })

  it('should apply plugin middleware to the model', async () => {
    const { wrapLanguageModel } = await import('ai')
    const testMiddleware = {
      specificationVersion: 'v3' as const,
      wrapGenerate: vi.fn((doGenerate: any) => doGenerate),
      wrapStream: vi.fn((doStream: any) => doStream)
    }

    const middlewarePlugin = definePlugin({
      name: 'test-middleware-plugin',
      configureContext: async (context) => {
        context.middlewares = context.middlewares || []
        context.middlewares.push(testMiddleware)
      }
    })

    await createAgent({
      providerId: 'openai',
      providerSettings: mockProviderConfigs.openai,
      modelId: 'gpt-4',
      plugins: [middlewarePlugin],
      agentSettings: {
        tools: {}
      }
    })

    expect(wrapLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({
        middleware: expect.arrayContaining([testMiddleware])
      })
    )
  })

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
