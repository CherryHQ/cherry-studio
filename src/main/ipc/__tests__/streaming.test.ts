import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIPCHandler } from '../AgentIPCHandler'

// Mock logger
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

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getFocusedWindow: vi.fn()
  }
}))

describe('Streaming IPC Protocol', () => {
  let handler: AgentIPCHandler
  let mockWindow: any
  let streamEmitter: EventEmitter

  beforeEach(() => {
    mockWindow = {
      webContents: {
        send: vi.fn()
      }
    }
    
    handler = new AgentIPCHandler(mockWindow)
    streamEmitter = new EventEmitter()
  })

  describe('Stream Message Processing', () => {
    it('should process stream start message', async () => {
      const streamStartMessage = {
        id: 'stream-123',
        type: 'stream-start',
        payload: {
          stream: true,
          sessionId: 'session-456',
          metadata: { agent: 'test-agent' }
        },
        timestamp: Date.now()
      }

      const result = await handler.processStreamMessage(streamStartMessage)
      
      expect(result.success).toBe(true)
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:stream-data',
        streamStartMessage
      )
    })

    it('should process streaming data chunks', async () => {
      const streamChunks = [
        {
          id: 'stream-123',
          type: 'stream',
          payload: {
            stream: true,
            chunk: 'First chunk of data',
            sequence: 1,
            sessionId: 'session-456'
          },
          timestamp: Date.now()
        },
        {
          id: 'stream-123',
          type: 'stream',
          payload: {
            stream: true,
            chunk: 'Second chunk of data',
            sequence: 2,
            sessionId: 'session-456'
          },
          timestamp: Date.now() + 1
        }
      ]

      for (const chunk of streamChunks) {
        const result = await handler.processStreamMessage(chunk)
        expect(result.success).toBe(true)
      }

      expect(mockWindow.webContents.send).toHaveBeenCalledTimes(2)
      expect(mockWindow.webContents.send).toHaveBeenNthCalledWith(
        1, 'agent:stream-data', streamChunks[0]
      )
      expect(mockWindow.webContents.send).toHaveBeenNthCalledWith(
        2, 'agent:stream-data', streamChunks[1]
      )
    })

    it('should process stream end message', async () => {
      const streamEndMessage = {
        id: 'stream-123',
        type: 'stream-end',
        payload: {
          stream: true,
          end: true,
          sessionId: 'session-456',
          summary: { totalChunks: 5, totalBytes: 1024 }
        },
        timestamp: Date.now()
      }

      const result = await handler.processStreamMessage(streamEndMessage)
      
      expect(result.success).toBe(true)
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:stream-end',
        streamEndMessage
      )
    })

    it('should process stream error message', async () => {
      const streamErrorMessage = {
        id: 'stream-123',
        type: 'stream-error',
        payload: {
          stream: true,
          error: 'Stream processing failed',
          code: 'STREAM_PROCESSING_ERROR',
          sessionId: 'session-456'
        },
        timestamp: Date.now()
      }

      const result = await handler.processStreamMessage(streamErrorMessage)
      
      expect(result.success).toBe(true)
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:stream-error',
        streamErrorMessage
      )
    })
  })

  describe('Stream Performance Requirements', () => {
    it('should forward streaming messages within 100ms requirement', async () => {
      const streamMessage = {
        id: 'perf-test',
        type: 'stream',
        payload: {
          stream: true,
          chunk: 'Performance test chunk with some data',
          sequence: 1
        },
        timestamp: Date.now()
      }

      const startTime = Date.now()
      await handler.processStreamMessage(streamMessage)
      const endTime = Date.now()
      
      const processingTime = endTime - startTime
      expect(processingTime).toBeLessThan(100)
    })

    it('should handle high-frequency streaming messages', async () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        id: `bulk-stream-${i}`,
        type: 'stream',
        payload: {
          stream: true,
          chunk: `Chunk ${i} with test data`,
          sequence: i + 1
        },
        timestamp: Date.now() + i
      }))

      const startTime = Date.now()
      
      for (const message of messages) {
        await handler.processStreamMessage(message)
      }
      
      const endTime = Date.now()
      const totalTime = endTime - startTime
      const averageTime = totalTime / messages.length
      
      // Each message should be processed in under 10ms on average
      expect(averageTime).toBeLessThan(10)
      expect(mockWindow.webContents.send).toHaveBeenCalledTimes(100)
    })

    it('should maintain message order in streaming', async () => {
      const orderedMessages = Array.from({ length: 10 }, (_, i) => ({
        id: 'ordered-stream',
        type: 'stream',
        payload: {
          stream: true,
          chunk: `Ordered chunk ${i}`,
          sequence: i + 1
        },
        timestamp: Date.now() + i
      }))

      // Process messages in order
      for (const message of orderedMessages) {
        await handler.processStreamMessage(message)
      }

      // Verify all messages were sent in correct order
      expect(mockWindow.webContents.send).toHaveBeenCalledTimes(10)
      
      for (let i = 0; i < orderedMessages.length; i++) {
        expect(mockWindow.webContents.send).toHaveBeenNthCalledWith(
          i + 1, 'agent:stream-data', orderedMessages[i]
        )
      }
    })
  })

  describe('Stream Error Handling', () => {
    it('should handle malformed stream messages gracefully', async () => {
      const malformedMessage = {
        id: 'malformed-stream',
        type: 'stream',
        payload: {
          // Missing required stream field
          chunk: 'Some data',
          sequence: 1
        },
        timestamp: Date.now()
      }

      const result = await handler.processStreamMessage(malformedMessage)
      
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('Invalid stream message')
    })

    it('should handle IPC send failures during streaming', async () => {
      mockWindow.webContents.send.mockImplementation(() => {
        throw new Error('IPC channel closed')
      })

      const streamMessage = {
        id: 'error-test',
        type: 'stream',
        payload: {
          stream: true,
          chunk: 'Test data',
          sequence: 1
        },
        timestamp: Date.now()
      }

      const result = await handler.processStreamMessage(streamMessage)
      
      // Should not throw, but return error result
      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to forward stream message')
    })

    it('should recover from stream interruptions', async () => {
      // Simulate interrupted stream
      const initialMessage = {
        id: 'recovery-test',
        type: 'stream',
        payload: {
          stream: true,
          chunk: 'Initial chunk',
          sequence: 1
        },
        timestamp: Date.now()
      }

      await handler.processStreamMessage(initialMessage)

      // Simulate error condition
      mockWindow.webContents.send.mockImplementationOnce(() => {
        throw new Error('Temporary failure')
      })

      const errorMessage = {
        id: 'recovery-test',
        type: 'stream',
        payload: {
          stream: true,
          chunk: 'Failed chunk',
          sequence: 2
        },
        timestamp: Date.now() + 1
      }

      const errorResult = await handler.processStreamMessage(errorMessage)
      expect(errorResult.success).toBe(false)

      // Simulate recovery
      mockWindow.webContents.send.mockRestore()
      mockWindow.webContents.send = vi.fn()

      const recoveryMessage = {
        id: 'recovery-test',
        type: 'stream',
        payload: {
          stream: true,
          chunk: 'Recovery chunk',
          sequence: 3
        },
        timestamp: Date.now() + 2
      }

      const recoveryResult = await handler.processStreamMessage(recoveryMessage)
      expect(recoveryResult.success).toBe(true)
    })
  })

  describe('Stream Session Management', () => {
    it('should track active stream sessions', async () => {
      const sessionId = 'session-789'
      
      const startMessage = {
        id: 'session-start',
        type: 'stream-start',
        payload: {
          stream: true,
          sessionId,
          metadata: { agent: 'test-agent' }
        },
        timestamp: Date.now()
      }

      await handler.processStreamMessage(startMessage)
      
      expect(handler.hasActiveStream(sessionId)).toBe(true)
    })

    it('should clean up completed stream sessions', async () => {
      const sessionId = 'session-cleanup'
      
      // Start stream
      const startMessage = {
        id: 'cleanup-start',
        type: 'stream-start',
        payload: {
          stream: true,
          sessionId,
          metadata: { agent: 'test-agent' }
        },
        timestamp: Date.now()
      }

      await handler.processStreamMessage(startMessage)
      expect(handler.hasActiveStream(sessionId)).toBe(true)

      // End stream
      const endMessage = {
        id: 'cleanup-end',
        type: 'stream-end',
        payload: {
          stream: true,
          end: true,
          sessionId
        },
        timestamp: Date.now() + 100
      }

      await handler.processStreamMessage(endMessage)
      expect(handler.hasActiveStream(sessionId)).toBe(false)
    })

    it('should handle concurrent stream sessions', async () => {
      const session1 = 'concurrent-session-1'
      const session2 = 'concurrent-session-2'
      
      // Start both sessions
      const start1 = {
        id: 'concurrent-1',
        type: 'stream-start',
        payload: { stream: true, sessionId: session1 },
        timestamp: Date.now()
      }

      const start2 = {
        id: 'concurrent-2', 
        type: 'stream-start',
        payload: { stream: true, sessionId: session2 },
        timestamp: Date.now() + 1
      }

      await handler.processStreamMessage(start1)
      await handler.processStreamMessage(start2)

      expect(handler.hasActiveStream(session1)).toBe(true)
      expect(handler.hasActiveStream(session2)).toBe(true)

      // End first session
      const end1 = {
        id: 'end-1',
        type: 'stream-end',
        payload: { stream: true, end: true, sessionId: session1 },
        timestamp: Date.now() + 100
      }

      await handler.processStreamMessage(end1)

      expect(handler.hasActiveStream(session1)).toBe(false)
      expect(handler.hasActiveStream(session2)).toBe(true)
    })
  })
})