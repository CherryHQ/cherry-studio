import { BrowserWindow, ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIPCHandler } from '../AgentIPCHandler'
import type { AgentMessage } from '../messageValidation'
import { IpcChannel } from '@shared/IpcChannel'

// Mock electron modules
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getFocusedWindow: vi.fn()
  },
  ipcMain: {
    handle: vi.fn()
  }
}))

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

describe('Agent IPC Integration', () => {
  let mockWindow: any
  let handler: AgentIPCHandler

  beforeEach(() => {
    mockWindow = {
      webContents: {
        send: vi.fn()
      }
    }
    
    handler = new AgentIPCHandler(mockWindow)
    vi.clearAllMocks()
  })

  describe('End-to-End Message Flow', () => {
    it('should handle complete request-response cycle', async () => {
      const requestMessage: AgentMessage = {
        id: 'e2e-test-001',
        type: 'request',
        payload: {
          command: 'execute_task',
          data: 'Hello from integration test',
          context: { sessionId: 'test-session' }
        },
        timestamp: Date.now()
      }

      // Process the message
      const result = await handler.processMessage(requestMessage)

      // Verify processing succeeded
      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()

      // Verify message was sanitized and validated
      expect(result.data.id).toBe(requestMessage.id)
      expect(result.data.type).toBe(requestMessage.type)
      expect(result.data.payload).toEqual(requestMessage.payload)
    })

    it('should handle complete streaming cycle', async () => {
      const streamStartMessage: AgentMessage = {
        id: 'stream-e2e-001',
        type: 'stream-start',
        payload: {
          stream: true,
          sessionId: 'stream-session-001',
          metadata: { agent: 'test-agent', task: 'code_generation' }
        },
        timestamp: Date.now()
      }

      const streamDataMessage: AgentMessage = {
        id: 'stream-e2e-001',
        type: 'stream',
        payload: {
          stream: true,
          chunk: 'Generated code chunk 1',
          sequence: 1,
          sessionId: 'stream-session-001'
        },
        timestamp: Date.now() + 1
      }

      const streamEndMessage: AgentMessage = {
        id: 'stream-e2e-001',
        type: 'stream-end',
        payload: {
          stream: true,
          end: true,
          sessionId: 'stream-session-001',
          summary: { totalChunks: 1, totalBytes: 20 }
        },
        timestamp: Date.now() + 2
      }

      // Process stream lifecycle
      const startResult = await handler.processStreamMessage(streamStartMessage)
      expect(startResult.success).toBe(true)
      expect(handler.hasActiveStream('stream-session-001')).toBe(true)

      const dataResult = await handler.processStreamMessage(streamDataMessage)
      expect(dataResult.success).toBe(true)

      const endResult = await handler.processStreamMessage(streamEndMessage)
      expect(endResult.success).toBe(true)
      expect(handler.hasActiveStream('stream-session-001')).toBe(false)

      // Verify IPC messages were sent to UI
      expect(mockWindow.webContents.send).toHaveBeenCalledTimes(3)
      expect(mockWindow.webContents.send).toHaveBeenNthCalledWith(
        1, 'agent:stream-data', streamStartMessage
      )
      expect(mockWindow.webContents.send).toHaveBeenNthCalledWith(
        2, 'agent:stream-data', streamDataMessage
      )
      expect(mockWindow.webContents.send).toHaveBeenNthCalledWith(
        3, 'agent:stream-end', streamEndMessage
      )
    })

    it('should meet 100ms performance requirement under load', async () => {
      const messages: AgentMessage[] = Array.from({ length: 10 }, (_, i) => ({
        id: `load-test-${i}`,
        type: 'request',
        payload: { command: 'bulk_process', data: `Task ${i}` },
        timestamp: Date.now() + i
      }))

      const startTime = Date.now()
      
      const results = await Promise.all(
        messages.map(msg => handler.processMessage(msg))
      )
      
      const endTime = Date.now()
      const totalTime = endTime - startTime
      const averageTime = totalTime / messages.length

      // All messages should succeed
      expect(results.every(r => r.success)).toBe(true)
      
      // Average processing time should meet the 100ms requirement
      expect(averageTime).toBeLessThan(100)
    })

    it('should handle graceful error recovery', async () => {
      // First simulate a network failure
      mockWindow.webContents.send.mockImplementationOnce(() => {
        throw new Error('IPC channel temporarily unavailable')
      })

      const errorMessage: AgentMessage = {
        id: 'error-recovery-test',
        type: 'response',
        payload: { result: 'error', data: 'test error recovery' },
        timestamp: Date.now()
      }

      // Should not throw, but handle gracefully
      await expect(handler.forwardToUI(errorMessage)).resolves.not.toThrow()

      // Restore normal functionality
      mockWindow.webContents.send.mockRestore()
      mockWindow.webContents.send = vi.fn()

      const recoveryMessage: AgentMessage = {
        id: 'recovery-test',
        type: 'response',
        payload: { result: 'success', data: 'recovered successfully' },
        timestamp: Date.now() + 1
      }

      // Should work normally after recovery
      await handler.forwardToUI(recoveryMessage)
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'agent:message-received', recoveryMessage
      )
    })
  })

  describe('Security and Validation', () => {
    it('should sanitize potentially dangerous content', async () => {
      const dangerousMessage: AgentMessage = {
        id: 'security-test',
        type: 'request',
        payload: {
          command: 'execute',
          data: '<script>alert("XSS")</script>Safe content',
          html: '<img src="x" onerror="alert(1)">',
          config: {
            setting: '<iframe src="evil.com"></iframe>Normal setting'
          }
        },
        timestamp: Date.now()
      }

      const result = await handler.processMessage(dangerousMessage)

      expect(result.success).toBe(true)
      expect(result.data.payload.data).not.toContain('<script>')
      expect(result.data.payload.html).not.toContain('onerror')
      expect(result.data.payload.config.setting).not.toContain('<iframe>')
      expect(result.data.payload.data).toContain('Safe content')
    })

    it('should reject malformed messages', async () => {
      const malformedMessage = {
        id: null,
        type: 'invalid-type',
        // missing payload
        timestamp: 'not-a-number'
      } as any

      const result = await handler.processMessage(malformedMessage)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})