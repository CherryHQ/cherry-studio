import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseApiClient } from '../../../AiProvider/clients'
import { BaseContext, MIDDLEWARE_CONTEXT_SYMBOL } from '../../type'
import { GenericLoggingMiddleware } from '../LoggingMiddleware'

// Mock console methods
const mockConsole = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}

// Replace console methods
vi.stubGlobal('console', mockConsole)

describe('LoggingMiddleware', () => {
  let mockContext: BaseContext
  let mockApiClient: BaseApiClient
  let mockNext: () => Promise<void>

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Mock BaseApiClient
    mockApiClient = {
      provider: { id: 'test-provider' }
    } as BaseApiClient

    // Mock BaseContext
    mockContext = {
      [MIDDLEWARE_CONTEXT_SYMBOL]: true,
      methodName: 'completions',
      apiClientInstance: mockApiClient,
      originalParams: {
        messages: [{ role: 'user', content: 'test message' }],
        mcpTools: [{ name: 'test-tool' }],
        streamOutput: true
      } as any,
      onChunkCallback: vi.fn()
    }

    // Mock next function
    mockNext = vi.fn().mockResolvedValue(undefined)
  })

  it('should log method initiation and success', async () => {
    await GenericLoggingMiddleware(mockContext, mockNext)

    // Check initiation log - fix the expected format
    expect(mockConsole.log).toHaveBeenCalledWith(
      expect.stringContaining(
        '[GenericLoggingMiddleware (test-provider-completions)] Initiating method call. Context:'
      ),
      expect.stringContaining('"1 messages", "1 tools", "streaming"')
    )

    // Check success log
    expect(mockConsole.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[GenericLoggingMiddleware \(test-provider-completions\)\] Successful\. Duration: \d+ms/)
    )

    // Verify next was called
    expect(mockNext).toHaveBeenCalledOnce()
  })

  it('should log method failure and re-throw error', async () => {
    const testError = new Error('Test error')
    mockNext = vi.fn().mockRejectedValue(testError)

    await expect(GenericLoggingMiddleware(mockContext, mockNext)).rejects.toThrow('Test error')

    // Check error log
    expect(mockConsole.error).toHaveBeenCalledWith(
      expect.stringMatching(/\[GenericLoggingMiddleware \(test-provider-completions\)\] Failed\. Duration: \d+ms/),
      testError
    )

    // Verify next was called
    expect(mockNext).toHaveBeenCalledOnce()
  })

  it('should handle context without messages, tools, or streaming', async () => {
    mockContext.originalParams = {} as any

    await GenericLoggingMiddleware(mockContext, mockNext)

    expect(mockConsole.log).toHaveBeenCalledWith(
      expect.stringContaining(
        '[GenericLoggingMiddleware (test-provider-completions)] Initiating method call. Context:'
      ),
      expect.stringContaining('"no messages", "no tools", "non-streaming"')
    )
  })

  it('should handle unknown provider id', async () => {
    mockApiClient.provider = { id: 'unknown-provider' } as any

    await GenericLoggingMiddleware(mockContext, mockNext)

    expect(mockConsole.log).toHaveBeenCalledWith(
      expect.stringContaining('[GenericLoggingMiddleware (unknown-provider-completions)] Initiating method call'),
      expect.any(String)
    )
  })

  it('should measure execution duration accurately', async () => {
    // Mock a delay in next function
    mockNext = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const startTime = Date.now()
    await GenericLoggingMiddleware(mockContext, mockNext)
    const endTime = Date.now()

    // Extract duration from log call
    const logCall = mockConsole.log.mock.calls.find((call) => call[0].includes('Successful. Duration:'))
    expect(logCall).toBeDefined()

    const durationMatch = logCall?.[0]?.match(/Duration: (\d+)ms/)
    expect(durationMatch).toBeDefined()

    const loggedDuration = parseInt(durationMatch[1])
    const actualDuration = endTime - startTime

    // Duration should be reasonably close (within 10ms tolerance)
    expect(loggedDuration).toBeGreaterThanOrEqual(40)
    expect(loggedDuration).toBeLessThanOrEqual(actualDuration + 10)
  })
})
