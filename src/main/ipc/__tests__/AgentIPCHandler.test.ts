import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIPCHandler } from '../AgentIPCHandler'
import type { AgentMessage } from '../messageValidation'

// Mock logger to avoid log output in tests
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

// Mock BrowserWindow
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getFocusedWindow: vi.fn()
  }
}))

describe('AgentIPCHandler', () => {
  let handler: AgentIPCHandler
  let mockWindow: any

  beforeEach(() => {
    mockWindow = {
      webContents: {
        send: vi.fn()
      }
    }
    
    handler = new AgentIPCHandler(mockWindow)
  })

  describe('Message Serialization', () => {
    it('should serialize agent message correctly', () => {
      const message = {
        id: 'test-id',
        type: 'request',
        payload: { command: 'execute', data: 'test data' },
        timestamp: Date.now()
      }

      const serialized = handler.serializeMessage(message)
      
      expect(serialized).toBeDefined()
      expect(typeof serialized).toBe('string')
      expect(JSON.parse(serialized)).toEqual(message)
    })

    it('should deserialize agent message correctly', () => {
      const message = {
        id: 'test-id',
        type: 'response',
        payload: { result: 'success', data: 'response data' },
        timestamp: Date.now()
      }

      const serialized = JSON.stringify(message)
      const deserialized = handler.deserializeMessage(serialized)
      
      expect(deserialized).toEqual(message)
    })

    it('should handle serialization errors gracefully', () => {
      const circularRef: any = {}
      circularRef.self = circularRef

      expect(() => handler.serializeMessage(circularRef)).toThrow()
    })

    it('should handle deserialization errors gracefully', () => {
      const invalidJson = 'invalid json string'

      expect(() => handler.deserializeMessage(invalidJson)).toThrow()
    })
  })

  describe('Message Validation', () => {
    it('should validate correct agent message format', () => {
      const validMessage = {
        id: 'test-id',
        type: 'request',
        payload: { command: 'execute' },
        timestamp: Date.now()
      }

      expect(() => handler.validateMessage(validMessage)).not.toThrow()
    })

    it('should reject message without required fields', () => {
      const invalidMessage = {
        type: 'request',
        payload: { command: 'execute' }
        // missing id and timestamp
      }

      expect(() => handler.validateMessage(invalidMessage)).toThrow('Message validation failed')
    })

    it('should reject message with invalid type', () => {
      const invalidMessage = {
        id: 'test-id',
        type: 'invalid-type',
        payload: { command: 'execute' },
        timestamp: Date.now()
      }

      expect(() => handler.validateMessage(invalidMessage)).toThrow('Invalid message type')
    })

    it('should reject message with invalid timestamp', () => {
      const invalidMessage = {
        id: 'test-id',
        type: 'request',
        payload: { command: 'execute' },
        timestamp: 'invalid-timestamp'
      }

      expect(() => handler.validateMessage(invalidMessage)).toThrow('Invalid timestamp')
    })
  })

  describe('Message Processing', () => {
    it('should process valid messages successfully', async () => {
      const message = {
        id: 'test-id',
        type: 'request',
        payload: { command: 'execute', data: 'test data' },
        timestamp: Date.now()
      }

      const result = await handler.processMessage(message)
      
      expect(result).toBeDefined()
      expect(result.success).toBe(true)
    })

    it('should handle message processing within 100ms requirement', async () => {
      const message = {
        id: 'test-id',
        type: 'request',
        payload: { command: 'execute', data: 'test data' },
        timestamp: Date.now()
      }

      const startTime = Date.now()
      await handler.processMessage(message)
      const endTime = Date.now()
      
      expect(endTime - startTime).toBeLessThan(100)
    })

    it('should forward messages to UI correctly', async () => {
      const message: AgentMessage = {
        id: 'test-id',
        type: 'response',
        payload: { result: 'success', data: 'response data' },
        timestamp: Date.now()
      }

      await handler.forwardToUI(message)
      
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:message-received',
        message
      )
    })
  })

  describe('Error Handling', () => {
    it('should log errors and attempt graceful recovery', async () => {
      const invalidMessage = { invalid: 'message' }
      
      const result = await handler.processMessage(invalidMessage as any)
      
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle IPC send errors gracefully', async () => {
      mockWindow.webContents.send.mockImplementation(() => {
        throw new Error('IPC send failed')
      })

      const message: AgentMessage = {
        id: 'test-id',
        type: 'response',
        payload: { result: 'success' },
        timestamp: Date.now()
      }

      // Should not throw, but handle gracefully
      await expect(handler.forwardToUI(message)).resolves.not.toThrow()
    })
  })

  describe('Streaming Protocol', () => {
    it('should handle streaming messages correctly', async () => {
      const streamMessage = {
        id: 'stream-id',
        type: 'stream',
        payload: { 
          stream: true,
          chunk: 'streaming data chunk',
          sequence: 1
        },
        timestamp: Date.now()
      }

      const result = await handler.processStreamMessage(streamMessage)
      
      expect(result.success).toBe(true)
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:stream-data',
        streamMessage
      )
    })

    it('should handle stream end messages', async () => {
      const endMessage = {
        id: 'stream-id',
        type: 'stream-end',
        payload: { stream: true, end: true },
        timestamp: Date.now()
      }

      await handler.processStreamMessage(endMessage)
      
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:stream-end',
        endMessage
      )
    })

    it('should handle stream error messages', async () => {
      const errorMessage = {
        id: 'stream-id',
        type: 'stream-error',
        payload: { 
          stream: true, 
          error: 'Stream processing failed',
          code: 'STREAM_ERROR'
        },
        timestamp: Date.now()
      }

      await handler.processStreamMessage(errorMessage)
      
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:stream-error',
        errorMessage
      )
    })
  })
})