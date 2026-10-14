/**
 * resolveLanguageModel — verifies that plugins passed in have their
 * configureContext middleware applied to the resolved model (the mechanism
 * chat retry uses to give a fallback model its own feature middleware).
 */
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createMockLanguageModel, createMockProviderV3, mockProviderConfigs } from '@test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { definePlugin } from '../../plugins'
import { resolveLanguageModel } from '../index'

vi.mock('../../providers', () => ({
  extensionRegistry: {
    has: vi.fn(() => true),
    createProvider: vi.fn(),
    getModelResolver: vi.fn(() => undefined)
  }
}))

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

describe('resolveLanguageModel', () => {
  let mockLanguageModel: LanguageModelV3

  beforeEach(async () => {
    vi.clearAllMocks()
    mockLanguageModel = createMockLanguageModel({ specificationVersion: 'v3', provider: 'openai', modelId: 'gpt-4' })
    const mockProvider = createMockProviderV3({ provider: 'openai', languageModel: vi.fn(() => mockLanguageModel) })
    const { extensionRegistry } = await import('../../providers')
    vi.mocked(extensionRegistry.createProvider).mockResolvedValue(mockProvider)
  })

  it('applies the passed plugins’ configureContext middleware to the resolved model', async () => {
    const { wrapLanguageModel } = await import('ai')
    const testMiddleware = {
      specificationVersion: 'v3' as const,
      wrapGenerate: vi.fn((doGenerate: any) => doGenerate),
      wrapStream: vi.fn((doStream: any) => doStream)
    }
    const middlewarePlugin = definePlugin({
      name: 'test-fallback-middleware',
      configureContext: async (context) => {
        context.middlewares = context.middlewares || []
        context.middlewares.push(testMiddleware)
      }
    })

    await resolveLanguageModel('openai', mockProviderConfigs.openai, 'gpt-4', [middlewarePlugin])

    expect(wrapLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({ middleware: expect.arrayContaining([testMiddleware]) })
    )
  })

  it('resolves a bare model when no plugins are passed', async () => {
    const { wrapLanguageModel } = await import('ai')
    const model = await resolveLanguageModel('openai', mockProviderConfigs.openai, 'gpt-4')
    expect(wrapLanguageModel).not.toHaveBeenCalled()
    expect(model).toBe(mockLanguageModel)
  })
})
