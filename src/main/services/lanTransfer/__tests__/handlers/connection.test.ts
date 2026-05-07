import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildHandshakeMessage,
  createDataHandler,
  getAbortError,
  HANDSHAKE_PROTOCOL_VERSION,
  pickHost,
  waitForSocketDrain
} from '../../handlers/connection'

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'Cherry Studio'),
    getVersion: vi.fn(() => '1.0.0')
  }
}))

describe('connection handlers', () => {
  describe('buildHandshakeMessage', () => {
    it('should build handshake message with correct structure', () => {
      const message = buildHandshakeMessage()

      expect(message.type).toBe('handshake')
      expect(message.deviceName).toBe('Cherry Studio')
      expect(message.version).toBe(HANDSHAKE_PROTOCOL_VERSION)
      expect(message.appVersion).toBe('1.0.0')
      expect(typeof message.platform).toBe('string')
    })

    it('should use protocol version 1', () => {
      expect(HANDSHAKE_PROTOCOL_VERSION).toBe('1')
    })
  })

  describe('pickHost', () => {
    it('should prefer IPv4 addresses', () => {
      const peer = {
        id: '1',
        name: 'Test',
        addresses: ['fe80::1', '192.168.1.100', '::1'],
        updatedAt: Date.now()
      }

      expect(pickHost(peer)).toBe('192.168.1.100')
    })

    it('should fall back to first address if no IPv4', () => {
      const peer = {
        id: '1',
        name: 'Test',
        addresses: ['fe80::1', '::1'],
        updatedAt: Date.now()
      }

      expect(pickHost(peer)).toBe('fe80::1')
    })

    it('should fall back to host property if no addresses', () => {
      const peer = {
        id: '1',
        name: 'Test',
        host: 'example.local',
        addresses: [],
        updatedAt: Date.now()
      }

      expect(pickHost(peer)).toBe('example.local')
    })

    it('should return undefined if no addresses or host', () => {
      const peer = {
        id: '1',
        name: 'Test',
        addresses: [],
        updatedAt: Date.now()
      }

      expect(pickHost(peer)).toBeUndefined()
    })
  })

  describe('createDataHandler', () => {
    it('should parse complete lines from buffer', () => {
      const lines: string[] = []
      const handler = createDataHandler((line) => lines.push(line))

      handler.handleData(Buffer.from('{"type":"test"}\n'))

      expect(lines).toEqual(['{"type":"test"}'])
    })

    it('should handle partial lines across multiple chunks', () => {
      const lines: string[] = []
      const handler = createDataHandler((line) => lines.push(line))

      handler.handleData(Buffer.from('{"type":'))
      handler.handleData(Buffer.from('"test"}\n'))

      expect(lines).toEqual(['{"type":"test"}'])
    })

    it('should handle multiple lines in single chunk', () => {
      const lines: string[] = []
      const handler = createDataHandler((line) => lines.push(line))

      handler.handleData(Buffer.from('{"a":1}\n{"b":2}\n'))

      expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    })

    it('should reset buffer', () => {
      const lines: string[] = []
      const handler = createDataHandler((line) => lines.push(line))

      handler.handleData(Buffer.from('partial'))
      handler.resetBuffer()
      handler.handleData(Buffer.from('{"complete":true}\n'))

      expect(lines).toEqual(['{"complete":true}'])
    })

    it('should trim whitespace from lines', () => {
      const lines: string[] = []
      const handler = createDataHandler((line) => lines.push(line))

      handler.handleData(Buffer.from('  {"type":"test"}  \n'))

      expect(lines).toEqual(['{"type":"test"}'])
    })

    it('should skip empty lines', () => {
      const lines: string[] = []
      const handler = createDataHandler((line) => lines.push(line))

      handler.handleData(Buffer.from('\n\n{"type":"test"}\n\n'))

      expect(lines).toEqual(['{"type":"test"}'])
    })

    it('should throw error when buffer exceeds MAX_LINE_BUFFER_SIZE', () => {
      const handler = createDataHandler(vi.fn())

      // Create a buffer larger than 1MB (MAX_LINE_BUFFER_SIZE)
      const largeData = 'x'.repeat(1024 * 1024 + 1)

      expect(() => handler.handleData(Buffer.from(largeData))).toThrow('Control message too large')
    })

    it('should reset buffer after exceeding MAX_LINE_BUFFER_SIZE', () => {
      const lines: string[] = []
      const handler = createDataHandler((line) => lines.push(line))

      // Create a buffer larger than 1MB
      const largeData = 'x'.repeat(1024 * 1024 + 1)

      try {
        handler.handleData(Buffer.from(largeData))
      } catch {
        // Expected error
      }

      // Buffer should be reset, so lineBuffer should be empty
      expect(handler.lineBuffer).toBe('')
    })
  })

  describe('waitForSocketDrain', () => {
    let mockSocket: Socket & EventEmitter

    beforeEach(() => {
      mockSocket = Object.assign(new EventEmitter(), {
        destroyed: false,
        writable: true,
        write: vi.fn(),
        off: vi.fn(),
        removeAllListeners: vi.fn()
      }) as unknown as Socket & EventEmitter
    })

    afterEach(() => {
      vi.resetAllMocks()
    })

    it('should throw error when abort signal is already aborted', async () => {
      const abortController = new AbortController()
      abortController.abort(new Error('Already aborted'))

      await expect(waitForSocketDrain(mockSocket, abortController.signal)).rejects.toThrow('Already aborted')
    })

    it('should throw error when socket is destroyed', async () => {
      ;(mockSocket as any).destroyed = true
      const abortController = new AbortController()

      await expect(waitForSocketDrain(mockSocket, abortController.signal)).rejects.toThrow('Socket is closed')
    })

    it('should resolve when drain event is emitted', async () => {
      const abortController = new AbortController()

      const drainPromise = waitForSocketDrain(mockSocket, abortController.signal)

      // Emit drain event after a short delay
      setImmediate(() => mockSocket.emit('drain'))

      await expect(drainPromise).resolves.toBeUndefined()
    })

    it('should reject when close event is emitted', async () => {
      const abortController = new AbortController()

      const drainPromise = waitForSocketDrain(mockSocket, abortController.signal)

      setImmediate(() => mockSocket.emit('close'))

      await expect(drainPromise).rejects.toThrow('Socket closed while waiting for drain')
    })

    it('should reject when error event is emitted', async () => {
      const abortController = new AbortController()

      const drainPromise = waitForSocketDrain(mockSocket, abortController.signal)

      setImmediate(() => mockSocket.emit('error', new Error('Network error')))

      await expect(drainPromise).rejects.toThrow('Network error')
    })

    it('should reject when abort signal is triggered', async () => {
      const abortController = new AbortController()

      const drainPromise = waitForSocketDrain(mockSocket, abortController.signal)

      setImmediate(() => abortController.abort(new Error('User cancelled')))

      await expect(drainPromise).rejects.toThrow('User cancelled')
    })
  })

  describe('getAbortError', () => {
    it('should return Error reason directly', () => {
      const originalError = new Error('Original')
      const signal = { aborted: true, reason: originalError } as AbortSignal

      expect(getAbortError(signal, 'Fallback')).toBe(originalError)
    })

    it('should create Error from string reason', () => {
      const signal = { aborted: true, reason: 'String reason' } as AbortSignal

      expect(getAbortError(signal, 'Fallback').message).toBe('String reason')
    })

    it('should use fallback for empty reason', () => {
      const signal = { aborted: true, reason: '' } as AbortSignal

      expect(getAbortError(signal, 'Fallback').message).toBe('Fallback')
    })
  })
})
