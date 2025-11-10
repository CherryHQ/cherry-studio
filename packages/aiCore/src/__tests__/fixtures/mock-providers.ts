/**
 * Mock Provider Instances
 * Provides mock implementations for all supported AI providers
 */

import type { ImageModelV2,LanguageModelV1 } from '@ai-sdk/provider'
import { vi } from 'vitest'

/**
 * Creates a mock language model with customizable behavior
 */
export function createMockLanguageModel(overrides?: Partial<LanguageModelV1>): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'mock-provider',
    modelId: 'mock-model',
    defaultObjectGenerationMode: 'tool',

    doGenerate: vi.fn().mockResolvedValue({
      text: 'Mock response text',
      finishReason: 'stop',
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30
      },
      rawCall: { rawPrompt: null, rawSettings: {} },
      rawResponse: { headers: {} },
      warnings: []
    }),

    doStream: vi.fn().mockReturnValue({
      stream: (async function* () {
        yield {
          type: 'text-delta',
          textDelta: 'Mock '
        }
        yield {
          type: 'text-delta',
          textDelta: 'streaming '
        }
        yield {
          type: 'text-delta',
          textDelta: 'response'
        }
        yield {
          type: 'finish',
          finishReason: 'stop',
          usage: {
            promptTokens: 10,
            completionTokens: 15,
            totalTokens: 25
          }
        }
      })(),
      rawCall: { rawPrompt: null, rawSettings: {} },
      rawResponse: { headers: {} },
      warnings: []
    }),

    ...overrides
  } as LanguageModelV1
}

/**
 * Creates a mock image model with customizable behavior
 */
export function createMockImageModel(overrides?: Partial<ImageModelV2>): ImageModelV2 {
  return {
    specificationVersion: 'v2',
    provider: 'mock-provider',
    modelId: 'mock-image-model',

    doGenerate: vi.fn().mockResolvedValue({
      images: [
        {
          base64: 'mock-base64-image-data',
          uint8Array: new Uint8Array([1, 2, 3, 4, 5]),
          mimeType: 'image/png'
        }
      ],
      warnings: []
    }),

    ...overrides
  } as ImageModelV2
}

/**
 * Mock provider configurations for testing
 */
export const mockProviderConfigs = {
  openai: {
    apiKey: 'sk-test-openai-key-123456789',
    baseURL: 'https://api.openai.com/v1',
    organization: 'test-org'
  },

  anthropic: {
    apiKey: 'sk-ant-test-key-123456789',
    baseURL: 'https://api.anthropic.com'
  },

  google: {
    apiKey: 'test-google-api-key-123456789',
    baseURL: 'https://generativelanguage.googleapis.com/v1'
  },

  xai: {
    apiKey: 'xai-test-key-123456789',
    baseURL: 'https://api.x.ai/v1'
  },

  azure: {
    apiKey: 'test-azure-key-123456789',
    resourceName: 'test-resource',
    deployment: 'test-deployment'
  },

  deepseek: {
    apiKey: 'sk-test-deepseek-key-123456789',
    baseURL: 'https://api.deepseek.com/v1'
  },

  openrouter: {
    apiKey: 'sk-or-test-key-123456789',
    baseURL: 'https://openrouter.ai/api/v1'
  },

  huggingface: {
    apiKey: 'hf_test_key_123456789',
    baseURL: 'https://api-inference.huggingface.co'
  },

  'openai-compatible': {
    apiKey: 'test-compatible-key-123456789',
    baseURL: 'https://api.example.com/v1',
    name: 'test-provider'
  },

  'openai-chat': {
    apiKey: 'sk-test-chat-key-123456789',
    baseURL: 'https://api.openai.com/v1'
  }
} as const

/**
 * Mock provider instances for testing
 */
export const mockProviderInstances = {
  openai: {
    name: 'openai-mock',
    languageModel: createMockLanguageModel({ provider: 'openai', modelId: 'gpt-4' }),
    imageModel: createMockImageModel({ provider: 'openai', modelId: 'dall-e-3' })
  },

  anthropic: {
    name: 'anthropic-mock',
    languageModel: createMockLanguageModel({ provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' })
  },

  google: {
    name: 'google-mock',
    languageModel: createMockLanguageModel({ provider: 'google', modelId: 'gemini-2.0-flash-exp' }),
    imageModel: createMockImageModel({ provider: 'google', modelId: 'imagen-3.0-generate-001' })
  },

  xai: {
    name: 'xai-mock',
    languageModel: createMockLanguageModel({ provider: 'xai', modelId: 'grok-2-latest' }),
    imageModel: createMockImageModel({ provider: 'xai', modelId: 'grok-2-image-latest' })
  },

  deepseek: {
    name: 'deepseek-mock',
    languageModel: createMockLanguageModel({ provider: 'deepseek', modelId: 'deepseek-chat' })
  }
}

export type ProviderId = keyof typeof mockProviderConfigs
