/**
 * Model Test Utilities
 * Provides comprehensive mock creators for AI SDK v4 models and related test utilities
 */

import type {
  EmbeddingModelV4,
  ImageModelV4,
  LanguageModelV4,
  LanguageModelV4Middleware,
  ProviderV4,
  RerankingModelV4
} from '@ai-sdk/provider'
import type { Tool, ToolSet } from 'ai'
import { tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { vi } from 'vitest'
import * as z from 'zod'

import type { StreamTextParams, StreamTextResult } from '../../src/core/plugins'
import type { AiRequestContext } from '../../src/types'

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
  const mockModel = new MockLanguageModelV4({
    provider: 'test-provider',
    modelId: 'test-model'
  })

  const base: AiRequestContext<StreamTextParams, StreamTextResult> = {
    providerId: 'openai',
    model: mockModel,
    originalParams: {
      model: mockModel,
      messages: [{ role: 'user', content: 'Test message' }]
    },
    metadata: {},
    startTime: Date.now(),
    requestId: 'test-request-id',
    recursiveCall: vi.fn(),
    isRecursiveCall: false,
    recursiveDepth: 0,
    maxRecursiveDepth: 10,
    extensions: new Map(),
    pluginState: {}
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
 * Compliant with AI SDK v4 specification
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
export function createMockEmbeddingModel(overrides?: Partial<EmbeddingModelV4>): EmbeddingModelV4 {
  return {
    specificationVersion: 'v4',
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
  }
}

export function createMockRerankingModel(overrides?: Partial<RerankingModelV4>): RerankingModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'mock-provider',
    modelId: 'mock-reranking-model',
    doRerank: vi.fn().mockResolvedValue({
      ranking: [
        { index: 1, relevanceScore: 0.9 },
        { index: 0, relevanceScore: 0.2 }
      ],
      response: { headers: {} }
    }),
    ...overrides
  }
}

/**
 * Creates a complete mock ProviderV4 with all model types
 * Useful for testing provider registration and management
 *
 * @example
 * ```ts
 * const provider = createMockProviderV4({
 *   provider: 'openai',
 *   languageModel: customLanguageModel,
 *   imageModel: customImageModel
 * })
 * ```
 */
export function createMockProviderV4(overrides?: {
  provider?: string
  languageModel?: (modelId: string) => LanguageModelV4
  imageModel?: (modelId: string) => ImageModelV4
  embeddingModel?: (modelId: string) => EmbeddingModelV4
  rerankingModel?: (modelId: string) => RerankingModelV4
}): ProviderV4 {
  const defaultLanguageModel = (modelId: string) =>
    ({
      specificationVersion: 'v4',
      provider: overrides?.provider ?? 'mock-provider',
      modelId,
      defaultObjectGenerationMode: 'tool',
      supportedUrls: {},
      doGenerate: vi.fn().mockResolvedValue({
        text: 'Mock response text',
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          inputTokenDetails: {},
          outputTokenDetails: {}
        },
        rawCall: { rawPrompt: null, rawSettings: {} },
        rawResponse: { headers: {} },
        warnings: []
      }),
      doStream: vi.fn().mockReturnValue({
        stream: (async function* () {
          yield { type: 'text-delta', textDelta: 'Mock ' }
          yield { type: 'text-delta', textDelta: 'streaming ' }
          yield { type: 'text-delta', textDelta: 'response' }
          yield {
            type: 'finish',
            finishReason: 'stop',
            usage: {
              inputTokens: 10,
              outputTokens: 15,
              totalTokens: 25,
              inputTokenDetails: {},
              outputTokenDetails: {}
            }
          }
        })(),
        rawCall: { rawPrompt: null, rawSettings: {} },
        rawResponse: { headers: {} },
        warnings: []
      })
    }) as LanguageModelV4

  const defaultImageModel = (modelId: string) =>
    ({
      specificationVersion: 'v4',
      provider: overrides?.provider ?? 'mock-provider',
      modelId,
      maxImagesPerCall: undefined,
      doGenerate: vi.fn().mockResolvedValue({
        images: [
          {
            base64: 'mock-base64-image-data',
            uint8Array: new Uint8Array([1, 2, 3, 4, 5]),
            mimeType: 'image/png'
          }
        ],
        warnings: []
      })
    }) as ImageModelV4

  const defaultEmbeddingModel = (modelId: string) =>
    ({
      specificationVersion: 'v4',
      provider: overrides?.provider ?? 'mock-provider',
      modelId,
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
      })
    }) as EmbeddingModelV4

  const defaultRerankingModel = (modelId: string) =>
    createMockRerankingModel({
      provider: overrides?.provider ?? 'mock-provider',
      modelId
    })

  return {
    specificationVersion: 'v4',
    provider: overrides?.provider ?? 'mock-provider',

    languageModel: vi.fn(overrides?.languageModel ?? defaultLanguageModel),
    imageModel: vi.fn(overrides?.imageModel ?? defaultImageModel),
    embeddingModel: vi.fn(overrides?.embeddingModel ?? defaultEmbeddingModel),
    rerankingModel: vi.fn(overrides?.rerankingModel ?? defaultRerankingModel)
  } as ProviderV4
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
export function createMockMiddleware(): LanguageModelV4Middleware {
  return { specificationVersion: 'v4' }
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
export function createMockProviderTool(name: string): Tool {
  return {
    type: 'provider',
    id: `test.${name}`,
    args: {},
    inputSchema: z.object({}),
    isProviderExecuted: false
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
      toolSet[name] = createMockProviderTool(name)
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
  language: new MockLanguageModelV4({
    provider: 'test-provider',
    modelId: 'test-model'
  }),

  /** Mock OpenAI GPT-4 model */
  gpt4: new MockLanguageModelV4({
    provider: 'openai',
    modelId: 'gpt-4'
  }),

  /** Mock Anthropic Claude model */
  claude: new MockLanguageModelV4({
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet-20241022'
  }),

  /** Mock Google Gemini model */
  gemini: new MockLanguageModelV4({
    provider: 'google',
    modelId: 'gemini-2.0-flash-exp'
  })
} as const
