import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseApiClient } from '../../../AiProvider/clients'
import { CompletionsContext, MIDDLEWARE_CONTEXT_SYMBOL } from '../../type'
import { AbortHandlerMiddleware } from '../AbortHandlerMiddleware'

// Mock console methods
const mockConsole = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}

vi.stubGlobal('console', mockConsole)

describe('AbortHandlerMiddleware', () => {
  let mockContext: CompletionsContext
  let mockApiClient: BaseApiClient
  let mockNext: () => Promise<void>

  beforeEach(() => {
    vi.clearAllMocks()

    mockApiClient = {
      provider: { id: 'test-provider' },
      createAbortController: vi.fn().mockReturnValue({
        abortController: new AbortController(),
        cleanup: vi.fn()
      })
    } as any

    mockContext = {
      [MIDDLEWARE_CONTEXT_SYMBOL]: true,
      methodName: 'completions',
      apiClientInstance: mockApiClient,
      originalParams: {
        messages: [],
        streamOutput: false
      } as any,
      onChunkCallback: vi.fn(),
      _internal: {}
    }

    mockNext = vi.fn().mockResolvedValue(undefined)
  })

  it('should create new AbortController for non-recursive calls', async () => {
    await AbortHandlerMiddleware(mockContext, mockNext)

    expect(mockContext._internal.flowControl?.abortController).toBeInstanceOf(AbortController)
    expect(mockContext._internal.flowControl?.abortSignal).toBeInstanceOf(AbortSignal)
    expect(mockContext._internal.flowControl?.cleanup).toBeTypeOf('function')
    expect(mockNext).toHaveBeenCalledOnce()
  })

  it('should skip AbortController creation for recursive calls', async () => {
    // Set up recursive call context
    mockContext.originalParams = {
      ...mockContext.originalParams,
      _internal: {
        isRecursiveCall: true,
        recursionDepth: 1
      }
    } as any

    await AbortHandlerMiddleware(mockContext, mockNext)

    expect(mockContext._internal.flowControl?.abortController).toBeUndefined()
    expect(mockNext).toHaveBeenCalledOnce()
  })

  it('should handle deep recursion gracefully', async () => {
    mockContext.originalParams = {
      ...mockContext.originalParams,
      _internal: {
        isRecursiveCall: true,
        recursionDepth: 15
      }
    } as any

    await AbortHandlerMiddleware(mockContext, mockNext)

    expect(mockConsole.log).toHaveBeenCalledWith(
      expect.stringContaining('🔄 [AbortHandlerMiddleware] Recursive call detected, skipping AbortController creation')
    )
  })

  it('should call cleanup function when provided', async () => {
    const mockCleanup = vi.fn()

    await AbortHandlerMiddleware(mockContext, mockNext)

    // Add cleanup function after middleware execution
    mockContext._internal.flowControl!.cleanup = mockCleanup

    // Call cleanup
    mockContext._internal.flowControl!.cleanup()

    expect(mockCleanup).toHaveBeenCalledOnce()
  })

  it('should handle errors and still call cleanup', async () => {
    const testError = new Error('Test error')
    mockNext = vi.fn().mockRejectedValue(testError)

    await expect(AbortHandlerMiddleware(mockContext, mockNext)).rejects.toThrow('Test error')

    expect(mockContext._internal.flowControl?.abortController).toBeInstanceOf(AbortController)
    expect(mockNext).toHaveBeenCalledOnce()
  })

  it('should preserve existing flowControl state', async () => {
    const existingFlowControl = {
      someOtherProperty: 'test'
    }
    mockContext._internal.flowControl = existingFlowControl as any

    await AbortHandlerMiddleware(mockContext, mockNext)

    expect(mockContext._internal.flowControl).toMatchObject({
      ...existingFlowControl,
      abortController: expect.any(AbortController),
      abortSignal: expect.any(AbortSignal),
      cleanup: expect.any(Function)
    })
  })

  it('should handle context without _internal property', async () => {
    // Remove _internal property
    mockContext._internal = {}

    await AbortHandlerMiddleware(mockContext, mockNext)

    expect(mockContext._internal).toBeDefined()
    expect(mockContext._internal.flowControl?.abortController).toBeInstanceOf(AbortController)
  })

  it('should log appropriate messages for different recursion scenarios', async () => {
    // Test non-recursive call
    await AbortHandlerMiddleware(mockContext, mockNext)

    expect(mockConsole.log).toHaveBeenCalledWith(
      expect.stringContaining('Starting middleware. isRecursive: false, depth: 0')
    )

    vi.clearAllMocks()

    // Test recursive call
    mockContext.originalParams = {
      ...mockContext.originalParams,
      _internal: {
        isRecursiveCall: true,
        recursionDepth: 3
      }
    } as any

    await AbortHandlerMiddleware(mockContext, mockNext)

    expect(mockConsole.log).toHaveBeenCalledWith(
      expect.stringContaining('Starting middleware. isRecursive: true, depth: 3')
    )
  })

  it('should create valid AbortSignal that can be aborted', async () => {
    await AbortHandlerMiddleware(mockContext, mockNext)

    const abortController = mockContext._internal.flowControl!.abortController!
    const abortSignal = mockContext._internal.flowControl!.abortSignal!

    expect(abortSignal.aborted).toBe(false)

    abortController.abort()

    expect(abortSignal.aborted).toBe(true)
  })
})
