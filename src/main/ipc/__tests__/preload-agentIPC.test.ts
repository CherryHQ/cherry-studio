import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron modules with proper factory function
vi.mock('electron', () => {
  const mockIpcRenderer = {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn()
  }

  return {
    ipcRenderer: mockIpcRenderer,
    contextBridge: {
      exposeInMainWorld: vi.fn()
    }
  }
})

// Import after mocking
import { agentIPC, AgentIPCBridge, type AgentMessage } from '../../../preload/agentIPC'
import { ipcRenderer } from 'electron'

const mockIpcRenderer = ipcRenderer as any

describe('Agent IPC Preload Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AgentIPCBridge', () => {
    let bridge: AgentIPCBridge

    beforeEach(() => {
      bridge = new AgentIPCBridge()
    })

    describe('Message Sending', () => {
      it('should send agent messages via IPC', async () => {
        const message: AgentMessage = {
          id: 'test-message',
          type: 'request',
          payload: { command: 'execute', data: 'test data' },
          timestamp: Date.now()
        }

        mockIpcRenderer.invoke.mockResolvedValue({ success: true })

        const result = await bridge.sendMessage(message)

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
          'agent:send-message',
          message
        )
        expect(result.success).toBe(true)
      })

      it('should handle IPC send failures gracefully', async () => {
        const message: AgentMessage = {
          id: 'error-message',
          type: 'request',
          payload: { command: 'execute' },
          timestamp: Date.now()
        }

        mockIpcRenderer.invoke.mockRejectedValue(new Error('IPC channel error'))

        const result = await bridge.sendMessage(message)

        expect(result.success).toBe(false)
        expect(result.error).toContain('IPC channel error')
      })

      it('should validate messages before sending', async () => {
        const invalidMessage = {
          // missing required fields
          type: 'request',
          payload: { command: 'execute' }
        } as any

        const result = await bridge.sendMessage(invalidMessage)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Message validation failed')
        expect(mockIpcRenderer.invoke).not.toHaveBeenCalled()
      })
    })

    describe('Stream Message Sending', () => {
      it('should send stream messages via IPC', async () => {
        const streamMessage: AgentMessage = {
          id: 'stream-test',
          type: 'stream',
          payload: {
            stream: true,
            chunk: 'streaming data',
            sequence: 1
          },
          timestamp: Date.now()
        }

        mockIpcRenderer.invoke.mockResolvedValue({ success: true })

        const result = await bridge.sendStreamMessage(streamMessage)

        expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
          'agent:stream-message',
          streamMessage
        )
        expect(result.success).toBe(true)
      })

      it('should handle stream message validation', async () => {
        const invalidStreamMessage: AgentMessage = {
          id: 'invalid-stream',
          type: 'stream',
          payload: {
            // missing stream: true
            chunk: 'data',
            sequence: 1
          },
          timestamp: Date.now()
        }

        const result = await bridge.sendStreamMessage(invalidStreamMessage)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Invalid stream message')
        expect(mockIpcRenderer.invoke).not.toHaveBeenCalled()
      })
    })

    describe('Message Listening', () => {
      it('should register message listeners', () => {
        const listener = vi.fn()
        
        bridge.onMessage(listener)

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          'agent:message-received',
          expect.any(Function)
        )
      })

      it('should register stream data listeners', () => {
        const streamListener = vi.fn()
        
        bridge.onStreamData(streamListener)

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          'agent:stream-data',
          expect.any(Function)
        )
      })

      it('should register stream end listeners', () => {
        const streamEndListener = vi.fn()
        
        bridge.onStreamEnd(streamEndListener)

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          'agent:stream-end',
          expect.any(Function)
        )
      })

      it('should register stream error listeners', () => {
        const streamErrorListener = vi.fn()
        
        bridge.onStreamError(streamErrorListener)

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
          'agent:stream-error',
          expect.any(Function)
        )
      })

      it('should handle listener removal', () => {
        const listener = vi.fn()
        
        const removeListener = bridge.onMessage(listener)
        removeListener()

        expect(mockIpcRenderer.off).toHaveBeenCalledWith(
          'agent:message-received',
          expect.any(Function)
        )
      })
    })

    describe('Message Processing', () => {
      it('should process received messages through listeners', () => {
        const messageListener = vi.fn()
        const receivedMessage = {
          id: 'received-test',
          type: 'response',
          payload: { result: 'success', data: 'response data' },
          timestamp: Date.now()
        }

        bridge.onMessage(messageListener)

        // Simulate IPC message reception
        const registeredCallback = mockIpcRenderer.on.mock.calls.find(
          call => call[0] === 'agent:message-received'
        )[1]

        registeredCallback(null, receivedMessage)

        expect(messageListener).toHaveBeenCalledWith(receivedMessage)
      })

      it('should process stream data through listeners', () => {
        const streamListener = vi.fn()
        const streamData = {
          id: 'stream-data-test',
          type: 'stream',
          payload: {
            stream: true,
            chunk: 'received stream chunk',
            sequence: 1
          },
          timestamp: Date.now()
        }

        bridge.onStreamData(streamListener)

        // Simulate stream data reception
        const registeredCallback = mockIpcRenderer.on.mock.calls.find(
          call => call[0] === 'agent:stream-data'
        )[1]

        registeredCallback(null, streamData)

        expect(streamListener).toHaveBeenCalledWith(streamData)
      })

      it('should handle malformed received messages gracefully', () => {
        const messageListener = vi.fn()
        const malformedMessage = { invalid: 'structure' }

        bridge.onMessage(messageListener)

        const registeredCallback = mockIpcRenderer.on.mock.calls.find(
          call => call[0] === 'agent:message-received'
        )[1]

        // Should not throw or crash
        expect(() => {
          registeredCallback(null, malformedMessage)
        }).not.toThrow()

        // Listener should not be called with invalid message
        expect(messageListener).not.toHaveBeenCalled()
      })
    })

    describe('Context Bridge Integration', () => {
      it('should expose agent IPC API to renderer context', () => {
        // Test that the API is properly structured for context bridge
        expect(agentIPC).toBeDefined()
        expect(typeof agentIPC.sendMessage).toBe('function')
        expect(typeof agentIPC.sendStreamMessage).toBe('function')
        expect(typeof agentIPC.onMessage).toBe('function')
        expect(typeof agentIPC.onStreamData).toBe('function')
        expect(typeof agentIPC.onStreamEnd).toBe('function')
        expect(typeof agentIPC.onStreamError).toBe('function')
      })

      it('should provide consistent API interface', async () => {
        const testMessage: AgentMessage = {
          id: 'api-test',
          type: 'request',
          payload: { command: 'test' },
          timestamp: Date.now()
        }

        mockIpcRenderer.invoke.mockResolvedValue({ success: true })

        // Test that the exposed API works the same as the bridge
        const result = await agentIPC.sendMessage(testMessage)
        expect(result.success).toBe(true)
      })
    })

    describe('Error Handling and Recovery', () => {
      it('should handle IPC channel disconnection', async () => {
        const message: AgentMessage = {
          id: 'disconnect-test',
          type: 'request',
          payload: { command: 'test' },
          timestamp: Date.now()
        }

        mockIpcRenderer.invoke.mockRejectedValue(new Error('Object has been destroyed'))

        const result = await bridge.sendMessage(message)

        expect(result.success).toBe(false)
        expect(result.error).toContain('IPC channel unavailable')
      })

      it('should attempt graceful recovery from failures', async () => {
        const message: AgentMessage = {
          id: 'recovery-test',
          type: 'request',
          payload: { command: 'test' },
          timestamp: Date.now()
        }

        // First call fails
        mockIpcRenderer.invoke.mockRejectedValueOnce(new Error('Temporary failure'))
        // Second call succeeds
        mockIpcRenderer.invoke.mockResolvedValueOnce({ success: true })

        const result1 = await bridge.sendMessage(message)
        expect(result1.success).toBe(false)

        const result2 = await bridge.sendMessage(message)
        expect(result2.success).toBe(true)
      })

      it('should log IPC errors for debugging', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        
        const message: AgentMessage = {
          id: 'error-log-test',
          type: 'request',
          payload: { command: 'test' },
          timestamp: Date.now()
        }

        mockIpcRenderer.invoke.mockRejectedValue(new Error('Test error'))

        await bridge.sendMessage(message)

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Agent IPC Error'),
          expect.any(Error)
        )

        consoleSpy.mockRestore()
      })
    })
  })

  describe('Performance Requirements', () => {
    it('should handle message sending within performance requirements', async () => {
      const bridge = new AgentIPCBridge()
      const message: AgentMessage = {
        id: 'perf-test',
        type: 'request',
        payload: { command: 'execute', data: 'performance test' },
        timestamp: Date.now()
      }

      mockIpcRenderer.invoke.mockResolvedValue({ success: true })

      const startTime = Date.now()
      await bridge.sendMessage(message)
      const endTime = Date.now()

      const processingTime = endTime - startTime
      expect(processingTime).toBeLessThan(100) // Within 100ms requirement
    })

    it('should handle high-frequency message sending', async () => {
      const bridge = new AgentIPCBridge()
      const messages: AgentMessage[] = Array.from({ length: 50 }, (_, i) => ({
        id: `bulk-${i}`,
        type: 'request',
        payload: { command: 'bulk-test', index: i },
        timestamp: Date.now() + i
      }))

      mockIpcRenderer.invoke.mockResolvedValue({ success: true })

      const startTime = Date.now()
      
      const results = await Promise.all(
        messages.map(msg => bridge.sendMessage(msg))
      )
      
      const endTime = Date.now()
      const totalTime = endTime - startTime
      const averageTime = totalTime / messages.length

      // All messages should succeed
      expect(results.every(r => r.success)).toBe(true)
      
      // Average processing time should be reasonable
      expect(averageTime).toBeLessThan(20)
    })
  })
})