/**
 * Model Test Utilities
 * Provides comprehensive mock creators for AI SDK v3 models and related test utilities
 */

import type {
  EmbeddingModelV3,
  ImageModelV3,
  LanguageModelV3,
  LanguageModelV3Middleware,
  ProviderV3
} from '@ai-sdk/provider'
import type { Tool, ToolSet } from 'ai'
import { tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { vi } from 'vitest'
import * as z from 'zod'

import type { StreamTextParams, StreamTextResult } from '../../core/plugins'
import type { ProviderId } from '../../core/providers/types'
import type { AiRequestContext } from '../../types'

/**
 * Type for partial overrides that allows omitting the model field
 * The model will be automatically added by createMockContext
 */
type ContextOverrides = Partial<Omit<AiRequestContext<StreamTextParams, StreamTextResult>, 'originalParams'>> & {
  originalParams?: Partial<Omit<StreamTextParams, 'model'>> & { model?: StreamTextParams['model'] }
}

/**
 * Creates a mock AiRequestContext with type safety
 * The model field is automatically added to originalParams if not provided
 *
 * @example
 * ```ts
 * const context = createMockContext({
 *   providerId: 'openai',
 *   metadata: { requestId: 'test-123' }
 * })
 * ```
 */
export function createMockContext(overrides?: ContextOverrides): AiRequestContext<StreamTextParams, StreamTextResult> {
  const mockModel = new MockLanguageModelV3({
    provider: 'test-provider',
    modelId: 'test-model'
  })

  const base: AiRequestContext<StreamTextParams, StreamTextResult> = {
    providerId: 'openai' as ProviderId,
    model: mockModel,
    originalParams: {
      model: mockModel,
      messages: [{ role: 'user', content: 'Test message' }]
    } as StreamTextParams,
    metadata: {},
    startTime: Date.now(),
    requestId: 'test-request-id',
    recursiveCall: vi.fn(),
    isRecursiveCall: false,
    recursiveDepth: 0,
    maxRecursiveDepth: 10,
    extensions: new Map()
  }

  if (overrides) {
    // Ensure model is always present in originalParams
    const mergedOriginalParams = {
      ...base.originalParams,
      ...overrides.originalParams,
      model: overrides.originalParams?.model ?? mockModel
    }

    return {
      ...base,
      ...overrides,
      originalParams: mergedOriginalParams as StreamTextParams
    }
  }

  return base
}

/**
 * Creates a mock embedding model with customizable behavior
 * Compliant with AI SDK v3 specification
 *
 * @example
 * ```ts
 * const embeddingModel = createMockEmbeddingModel({
 *   provider: 'openai',
 *   modelId: 'text-embedding-3-small',
 *   maxEmbeddingsPerCall: 2048
 * })
 * ```
 */
export function createMockEmbeddingModel(overrides?: Partial<EmbeddingModelV3>): EmbeddingModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'mock-provider',
    modelId: 'mock-embedding-model',
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,

    doEmbed: vi.fn().mockResolvedValue({
      embeddings: [
        [0.1, 0.2, 0.3, 0.4, 0.5],
        [0.6, 0.7, 0.8, 0.9, 1.0]
      ],
      usage: {
        inputTokens: 10,
        totalTokens: 10
      },
      rawResponse: { headers: {} }
    }),

    ...overrides
  } as EmbeddingModelV3
}

/**
 * Creates a complete mock ProviderV3 with all model types
 * Useful for testing provider registration and management
 *
 * @example
 * ```ts
 * const provider = createMockProviderV3({
 *   provider: 'openai',
 *   languageModel: customLanguageModel,
 *   imageModel: customImageModel
 * })
 * ```
 */
export function createMockProviderV3(overrides?: {
  provider?: string
  languageModel?: (modelId: string) => LanguageModelV3
  imageModel?: (modelId: string) => ImageModelV3
  embeddingModel?: (modelId: string) => EmbeddingModelV3
}): ProviderV3 {
  return {
    specificationVersion: 'v3',
    provider: overrides?.provider ?? 'mock-provider',

    languageModel: overrides?.languageModel
      ? overrides.languageModel
      : (modelId: string) =>
          ({
            specificationVersion: 'v3',
            provider: overrides?.provider ?? 'mock-provider',
            modelId,
            defaultObjectGenerationMode: 'tool',
            supportedUrls: {},
            doGenerate: vi.fn(),
            doStream: vi.fn()
          }) as LanguageModelV3,

    imageModel: overrides?.imageModel
      ? overrides.imageModel
      : (modelId: string) =>
          ({
            specificationVersion: 'v3',
            provider: overrides?.provider ?? 'mock-provider',
            modelId,
            maxImagesPerCall: undefined,
            doGenerate: vi.fn()
          }) as ImageModelV3,

    embeddingModel: overrides?.embeddingModel
      ? overrides.embeddingModel
      : (modelId: string) =>
          ({
            specificationVersion: 'v3',
            provider: overrides?.provider ?? 'mock-provider',
            modelId,
            maxEmbeddingsPerCall: 100,
            supportsParallelCalls: true,
            doEmbed: vi.fn()
          }) as EmbeddingModelV3
  } as ProviderV3
}

/**
 * Creates a mock middleware for testing middleware chains
 * Supports both generate and stream wrapping
 *
 * @example
 * ```ts
 * const middleware = createMockMiddleware({
 *   name: 'test-middleware'
 * })
 * ```
 */
export function createMockMiddleware(): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',
    wrapGenerate: vi.fn((doGenerate) => doGenerate),
    wrapStream: vi.fn((doStream) => doStream)
  }
}

/**
 * Creates a type-safe function tool for testing using AI SDK's tool() function
 *
 * @example
 * ```ts
 * const weatherTool = createMockTool('getWeather', 'Get current weather')
 * ```
 */
export function createMockTool(name: string, description?: string): Tool<{ value?: string }, string> {
  return tool({
    description: description || `Mock tool: ${name}`,
    inputSchema: z.object({
      value: z.string().optional()
    }),
    execute: vi.fn(async () => 'mock result')
  })
}

/**
 * Creates a provider-defined tool for testing
 */
export function createMockProviderTool(name: string, description?: string): { type: 'provider'; description: string } {
  return {
    type: 'provider' as const,
    description: description || `Mock provider tool: ${name}`
  }
}

/**
 * Creates a ToolSet with multiple tools
 *
 * @example
 * ```ts
 * const tools = createMockToolSet({
 *   getWeather: 'function',
 *   searchDatabase: 'function',
 *   nativeSearch: 'provider'
 * })
 * ```
 */
export function createMockToolSet(tools: Record<string, 'function' | 'provider'>): ToolSet {
  const toolSet: ToolSet = {}

  for (const [name, type] of Object.entries(tools)) {
    if (type === 'function') {
      toolSet[name] = createMockTool(name)
    } else {
      toolSet[name] = createMockProviderTool(name) as Tool
    }
  }

  return toolSet
}

/**
 * Creates mock stream params for testing
 *
 * @example
 * ```ts
 * const params = createMockStreamParams({
 *   messages: [{ role: 'user', content: 'Custom message' }],
 *   temperature: 0.7
 * })
 * ```
 */
export function createMockStreamParams(overrides?: Partial<StreamTextParams>): StreamTextParams {
  return {
    messages: [{ role: 'user', content: 'Test message' }],
    ...overrides
  } as StreamTextParams
}

/**
 * Common mock model instances for quick testing
 */
export const mockModels = {
  /** Standard language model for general testing */
  language: new MockLanguageModelV3({
    provider: 'test-provider',
    modelId: 'test-model'
  }),

  /** Mock OpenAI GPT-4 model */
  gpt4: new MockLanguageModelV3({
    provider: 'openai',
    modelId: 'gpt-4'
  }),

  /** Mock Anthropic Claude model */
  claude: new MockLanguageModelV3({
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet-20241022'
  }),

  /** Mock Google Gemini model */
  gemini: new MockLanguageModelV3({
    provider: 'google',
    modelId: 'gemini-2.0-flash-exp'
  })
} as const
