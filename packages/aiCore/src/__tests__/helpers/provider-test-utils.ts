/**
 * Provider-Specific Test Utilities
 * Helper functions for testing individual providers with all their parameters
 */

import type { Tool } from 'ai'
import { expect } from 'vitest'

/**
 * Provider parameter configurations for comprehensive testing
 */
export const providerParameterMatrix = {
  openai: {
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4o'],
    parameters: {
      temperature: [0, 0.5, 0.7, 1.0, 1.5, 2.0],
      maxTokens: [100, 500, 1000, 2000, 4000],
      topP: [0.1, 0.5, 0.9, 1.0],
      frequencyPenalty: [-2.0, -1.0, 0, 1.0, 2.0],
      presencePenalty: [-2.0, -1.0, 0, 1.0, 2.0],
      stop: [undefined, ['stop'], ['STOP', 'END']],
      seed: [undefined, 12345, 67890],
      responseFormat: [undefined, { type: 'json_object' as const }],
      user: [undefined, 'test-user-123']
    },
    toolChoice: ['auto', 'required', 'none', { type: 'function' as const, name: 'getWeather' }],
    parallelToolCalls: [true, false]
  },

  anthropic: {
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    parameters: {
      temperature: [0, 0.5, 1.0],
      maxTokens: [100, 1000, 4000, 8000],
      topP: [0.1, 0.5, 0.9, 1.0],
      topK: [undefined, 1, 5, 10, 40],
      stop: [undefined, ['Human:', 'Assistant:']],
      metadata: [undefined, { userId: 'test-123' }]
    },
    toolChoice: ['auto', 'any', { type: 'tool' as const, name: 'getWeather' }]
  },

  google: {
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    parameters: {
      temperature: [0, 0.5, 0.9, 1.0],
      maxTokens: [100, 1000, 2000, 8000],
      topP: [0.1, 0.5, 0.95, 1.0],
      topK: [undefined, 1, 16, 40],
      stopSequences: [undefined, ['END'], ['STOP', 'TERMINATE']]
    },
    safetySettings: [
      undefined,
      [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    ]
  },

  xai: {
    models: ['grok-2-latest', 'grok-2-1212'],
    parameters: {
      temperature: [0, 0.5, 1.0, 1.5],
      maxTokens: [100, 500, 2000, 4000],
      topP: [0.1, 0.5, 0.9, 1.0],
      stop: [undefined, ['STOP'], ['END', 'TERMINATE']],
      seed: [undefined, 12345]
    }
  },

  deepseek: {
    models: ['deepseek-chat', 'deepseek-coder'],
    parameters: {
      temperature: [0, 0.5, 1.0],
      maxTokens: [100, 1000, 4000],
      topP: [0.1, 0.5, 0.95],
      frequencyPenalty: [0, 0.5, 1.0],
      presencePenalty: [0, 0.5, 1.0],
      stop: [undefined, ['```'], ['END']]
    }
  },

  azure: {
    deployments: ['gpt-4-deployment', 'gpt-35-turbo-deployment'],
    parameters: {
      temperature: [0, 0.7, 1.0],
      maxTokens: [100, 1000, 2000],
      topP: [0.1, 0.5, 0.95],
      frequencyPenalty: [0, 1.0],
      presencePenalty: [0, 1.0],
      stop: [undefined, ['STOP']]
    }
  }
} as const

/**
 * Creates test cases for all parameter combinations
 */
export function generateParameterTestCases<T extends Record<string, any[]>>(
  params: T,
  maxCombinations = 50
): Array<Partial<{ [K in keyof T]: T[K][number] }>> {
  const keys = Object.keys(params) as Array<keyof T>
  const testCases: Array<Partial<{ [K in keyof T]: T[K][number] }>> = []

  // Generate combinations using sampling strategy for large parameter spaces
  const totalCombinations = keys.reduce((acc, key) => acc * params[key].length, 1)

  if (totalCombinations <= maxCombinations) {
    // Generate all combinations if total is small
    generateAllCombinations(params, keys, 0, {}, testCases)
  } else {
    // Sample diverse combinations if total is large
    generateSampledCombinations(params, keys, maxCombinations, testCases)
  }

  return testCases
}

function generateAllCombinations<T extends Record<string, any[]>>(
  params: T,
  keys: Array<keyof T>,
  index: number,
  current: Partial<{ [K in keyof T]: T[K][number] }>,
  results: Array<Partial<{ [K in keyof T]: T[K][number] }>>
) {
  if (index === keys.length) {
    results.push({ ...current })
    return
  }

  const key = keys[index]
  for (const value of params[key]) {
    generateAllCombinations(params, keys, index + 1, { ...current, [key]: value }, results)
  }
}

function generateSampledCombinations<T extends Record<string, any[]>>(
  params: T,
  keys: Array<keyof T>,
  count: number,
  results: Array<Partial<{ [K in keyof T]: T[K][number] }>>
) {
  // Generate edge cases first (min/max values)
  const edgeCase1: any = {}
  const edgeCase2: any = {}

  for (const key of keys) {
    edgeCase1[key] = params[key][0]
    edgeCase2[key] = params[key][params[key].length - 1]
  }

  results.push(edgeCase1, edgeCase2)

  // Generate random combinations for the rest
  for (let i = results.length; i < count; i++) {
    const combination: any = {}
    for (const key of keys) {
      const values = params[key]
      combination[key] = values[Math.floor(Math.random() * values.length)]
    }
    results.push(combination)
  }
}

/**
 * Validates that all provider-specific parameters are correctly passed through
 */
export function validateProviderParams(providerId: string, actualParams: any, expectedParams: any): void {
  const requiredFields: Record<string, string[]> = {
    openai: ['model', 'messages'],
    anthropic: ['model', 'messages'],
    google: ['model', 'contents'],
    xai: ['model', 'messages'],
    deepseek: ['model', 'messages'],
    azure: ['messages']
  }

  const fields = requiredFields[providerId] || ['model', 'messages']

  for (const field of fields) {
    expect(actualParams).toHaveProperty(field)
  }

  // Validate optional parameters if they were provided
  const optionalParams = ['temperature', 'max_tokens', 'top_p', 'stop', 'tools']

  for (const param of optionalParams) {
    if (expectedParams[param] !== undefined) {
      expect(actualParams[param]).toEqual(expectedParams[param])
    }
  }
}

/**
 * Creates a comprehensive test suite for a provider
 */
// oxlint-disable-next-line no-unused-vars
export function createProviderTestSuite(_providerId: string) {
  return {
    testBasicCompletion: async (executor: any, model: string) => {
      const result = await executor.generateText({
        model,
        messages: [{ role: 'user' as const, content: 'Hello' }]
      })

      expect(result).toBeDefined()
      expect(result.text).toBeDefined()
      expect(typeof result.text).toBe('string')
    },

    testStreaming: async (executor: any, model: string) => {
      const chunks: any[] = []
      const result = await executor.streamText({
        model,
        messages: [{ role: 'user' as const, content: 'Hello' }]
      })

      for await (const chunk of result.textStream) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
    },

    testTemperature: async (executor: any, model: string, temperatures: number[]) => {
      for (const temperature of temperatures) {
        const result = await executor.generateText({
          model,
          messages: [{ role: 'user' as const, content: 'Hello' }],
          temperature
        })

        expect(result).toBeDefined()
      }
    },

    testMaxTokens: async (executor: any, model: string, maxTokensValues: number[]) => {
      for (const maxTokens of maxTokensValues) {
        const result = await executor.generateText({
          model,
          messages: [{ role: 'user' as const, content: 'Hello' }],
          maxTokens
        })

        expect(result).toBeDefined()
        if (result.usage?.completionTokens) {
          expect(result.usage.completionTokens).toBeLessThanOrEqual(maxTokens)
        }
      }
    },

    testToolCalling: async (executor: any, model: string, tools: Record<string, Tool>) => {
      const result = await executor.generateText({
        model,
        messages: [{ role: 'user' as const, content: 'What is the weather in SF?' }],
        tools
      })

      expect(result).toBeDefined()
    },

    testStopSequences: async (executor: any, model: string, stopSequences: string[][]) => {
      for (const stop of stopSequences) {
        const result = await executor.generateText({
          model,
          messages: [{ role: 'user' as const, content: 'Count to 10' }],
          stop
        })

        expect(result).toBeDefined()
      }
    }
  }
}

/**
 * Generates test data for vision/multimodal testing
 */
export function createVisionTestData() {
  return {
    imageUrl: 'https://example.com/test-image.jpg',
    base64Image:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'What is in this image?' },
          {
            type: 'image' as const,
            image:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          }
        ]
      }
    ]
  }
}

/**
 * Creates mock responses for different finish reasons
 */
export function createFinishReasonMocks() {
  return {
    stop: {
      text: 'Complete response.',
      finishReason: 'stop' as const,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    },
    length: {
      text: 'Incomplete response due to',
      finishReason: 'length' as const,
      usage: { promptTokens: 10, completionTokens: 100, totalTokens: 110 }
    },
    'tool-calls': {
      text: 'Calling tools',
      finishReason: 'tool-calls' as const,
      toolCalls: [{ toolCallId: 'call_1', toolName: 'getWeather', args: { location: 'SF' } }],
      usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 }
    },
    'content-filter': {
      text: '',
      finishReason: 'content-filter' as const,
      usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 }
    }
  }
}
