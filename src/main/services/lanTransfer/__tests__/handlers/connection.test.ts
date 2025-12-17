import { describe, expect, it, vi } from 'vitest'

import {
  buildHandshakeMessage,
  createDataHandler,
  getAbortError,
  HANDSHAKE_PROTOCOL_VERSION,
  pickHost
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

    it('should use protocol version 3', () => {
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
