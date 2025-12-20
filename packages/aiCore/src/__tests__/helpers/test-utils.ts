/**
 * Test Utilities
 * Helper functions for testing AI Core functionality
 */

import { expect, vi } from 'vitest'

import type { ProviderId } from '../fixtures/mock-providers'
import { createMockImageModel, createMockLanguageModel, mockProviderConfigs } from '../fixtures/mock-providers'

/**
 * Creates a test provider with streaming support
 */
export function createTestStreamingProvider(chunks: any[]) {
  return createMockLanguageModel({
    doStream: vi.fn().mockReturnValue({
      stream: (async function* () {
        for (const chunk of chunks) {
          yield chunk
        }
      })(),
      rawCall: { rawPrompt: null, rawSettings: {} },
      rawResponse: { headers: {} },
      warnings: []
    })
  })
}

/**
 * Creates a test provider that throws errors
 */
export function createErrorProvider(error: Error) {
  return createMockLanguageModel({
    doGenerate: vi.fn().mockRejectedValue(error),
    doStream: vi.fn().mockImplementation(() => {
      throw error
    })
  })
}

/**
 * Collects all chunks from a stream
 */
export async function collectStreamChunks<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return chunks
}

/**
 * Waits for a specific number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Creates a mock abort controller that aborts after a delay
 */
export function createDelayedAbortController(delayMs: number): AbortController {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), delayMs)
  return controller
}

/**
 * Asserts that a function throws an error with a specific message
 */
export async function expectError(fn: () => Promise<any>, expectedMessage?: string | RegExp): Promise<Error> {
  try {
    await fn()
    throw new Error('Expected function to throw an error, but it did not')
  } catch (error) {
    if (expectedMessage) {
      const message = (error as Error).message
      if (typeof expectedMessage === 'string') {
        if (!message.includes(expectedMessage)) {
          throw new Error(`Expected error message to include "${expectedMessage}", but got "${message}"`)
        }
      } else {
        if (!expectedMessage.test(message)) {
          throw new Error(`Expected error message to match ${expectedMessage}, but got "${message}"`)
        }
      }
    }
    return error as Error
  }
}

/**
 * Creates a spy function that tracks calls and arguments
 */
export function createSpy<T extends (...args: any[]) => any>() {
  const calls: Array<{ args: Parameters<T>; result?: ReturnType<T>; error?: Error }> = []

  const spy = vi.fn((...args: Parameters<T>) => {
    try {
      const result = undefined as ReturnType<T>
      calls.push({ args, result })
      return result
    } catch (error) {
      calls.push({ args, error: error as Error })
      throw error
    }
  })

  return {
    fn: spy,
    calls,
    getCalls: () => calls,
    getCallCount: () => calls.length,
    getLastCall: () => calls[calls.length - 1],
    reset: () => {
      calls.length = 0
      spy.mockClear()
    }
  }
}

/**
 * Validates provider configuration
 */
export function validateProviderConfig(providerId: ProviderId) {
  const config = mockProviderConfigs[providerId]
  if (!config) {
    throw new Error(`No mock configuration found for provider: ${providerId}`)
  }

  if (!config.apiKey) {
    throw new Error(`Provider ${providerId} is missing apiKey in mock config`)
  }

  return config
}

/**
 * Creates a test context with common setup
 */
export function createTestContext() {
  const mocks = {
    languageModel: createMockLanguageModel(),
    imageModel: createMockImageModel(),
    providers: new Map<string, any>()
  }

  const cleanup = () => {
    mocks.providers.clear()
    vi.clearAllMocks()
  }

  return {
    mocks,
    cleanup
  }
}

/**
 * Measures execution time of an async function
 */
export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = Date.now()
  const result = await fn()
  const duration = Date.now() - start
  return { result, duration }
}

/**
 * Retries a function until it succeeds or max attempts reached
 */
export async function retryUntilSuccess<T>(fn: () => Promise<T>, maxAttempts = 3, delayMs = 100): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (attempt < maxAttempts) {
        await wait(delayMs)
      }
    }
  }

  throw lastError || new Error('All retry attempts failed')
}

/**
 * Creates a mock streaming response that emits chunks at intervals
 */
export function createTimedStream<T>(chunks: T[], intervalMs = 10) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        await wait(intervalMs)
        yield chunk
      }
    }
  }
}

/**
 * Asserts that two objects are deeply equal, ignoring specified keys
 */
export function assertDeepEqualIgnoring<T extends Record<string, any>>(
  actual: T,
  expected: T,
  ignoreKeys: string[] = []
): void {
  const filterKeys = (obj: T): Partial<T> => {
    const filtered = { ...obj }
    for (const key of ignoreKeys) {
      delete filtered[key]
    }
    return filtered
  }

  const filteredActual = filterKeys(actual)
  const filteredExpected = filterKeys(expected)

  expect(filteredActual).toEqual(filteredExpected)
}

/**
 * Creates a provider mock that simulates rate limiting
 */
export function createRateLimitedProvider(limitPerSecond: number) {
  const calls: number[] = []

  return createMockLanguageModel({
    doGenerate: vi.fn().mockImplementation(async () => {
      const now = Date.now()
      calls.push(now)

      // Remove calls older than 1 second
      const recentCalls = calls.filter((time) => now - time < 1000)

      if (recentCalls.length > limitPerSecond) {
        throw new Error('Rate limit exceeded')
      }

      return {
        text: 'Rate limited response',
        finishReason: 'stop' as const,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        rawCall: { rawPrompt: null, rawSettings: {} },
        rawResponse: { headers: {} },
        warnings: []
      }
    })
  })
}

/**
 * Validates streaming response structure
 */
export function validateStreamChunk(chunk: any): void {
  expect(chunk).toBeDefined()
  expect(chunk).toHaveProperty('type')

  if (chunk.type === 'text-delta') {
    expect(chunk).toHaveProperty('textDelta')
    expect(typeof chunk.textDelta).toBe('string')
  } else if (chunk.type === 'finish') {
    expect(chunk).toHaveProperty('finishReason')
    expect(chunk).toHaveProperty('usage')
  } else if (chunk.type === 'tool-call') {
    expect(chunk).toHaveProperty('toolCallId')
    expect(chunk).toHaveProperty('toolName')
    expect(chunk).toHaveProperty('args')
  }
}

/**
 * Creates a test logger that captures log messages
 */
export function createTestLogger() {
  const logs: Array<{ level: string; message: string; meta?: any }> = []

  return {
    info: (message: string, meta?: any) => logs.push({ level: 'info', message, meta }),
    warn: (message: string, meta?: any) => logs.push({ level: 'warn', message, meta }),
    error: (message: string, meta?: any) => logs.push({ level: 'error', message, meta }),
    debug: (message: string, meta?: any) => logs.push({ level: 'debug', message, meta }),
    getLogs: () => logs,
    clear: () => {
      logs.length = 0
    }
  }
}
