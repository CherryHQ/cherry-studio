import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BINARY_TYPE_FILE_CHUNK, sendBinaryChunk } from '../binaryProtocol'

describe('binaryProtocol', () => {
  describe('sendBinaryChunk', () => {
    let mockSocket: Socket
    let writtenBuffers: Buffer[]

    beforeEach(() => {
      writtenBuffers = []
      mockSocket = Object.assign(new EventEmitter(), {
        destroyed: false,
        writable: true,
        write: vi.fn((buffer: Buffer) => {
          writtenBuffers.push(Buffer.from(buffer))
          return true
        }),
        cork: vi.fn(),
        uncork: vi.fn()
      }) as unknown as Socket
    })

    it('should send binary chunk with correct frame format', () => {
      const transferId = 'test-uuid-1234'
      const chunkIndex = 5
      const data = Buffer.from('test data chunk')

      const result = sendBinaryChunk(mockSocket, transferId, chunkIndex, data)

      expect(result).toBe(true)
      expect(mockSocket.cork).toHaveBeenCalled()
      expect(mockSocket.uncork).toHaveBeenCalled()
      expect(mockSocket.write).toHaveBeenCalledTimes(2)

      // Verify header structure
      const header = writtenBuffers[0]

      // Magic bytes "CS"
      expect(header[0]).toBe(0x43)
      expect(header[1]).toBe(0x53)

      // Type byte
      const typeOffset = 2 + 4 // magic + totalLen
      expect(header[typeOffset]).toBe(BINARY_TYPE_FILE_CHUNK)

      // TransferId length
      const tidLenOffset = typeOffset + 1
      const tidLen = header.readUInt16BE(tidLenOffset)
      expect(tidLen).toBe(Buffer.from(transferId).length)

      // ChunkIndex
      const chunkIdxOffset = tidLenOffset + 2 + tidLen
      expect(header.readUInt32BE(chunkIdxOffset)).toBe(chunkIndex)

      // Data buffer
      expect(writtenBuffers[1].toString()).toBe('test data chunk')
    })

    it('should return false when socket write returns false (backpressure)', () => {
      ;(mockSocket.write as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)

      const result = sendBinaryChunk(mockSocket, 'test-id', 0, Buffer.from('data'))

      expect(result).toBe(false)
    })

    it('should correctly calculate totalLen in frame header', () => {
      const transferId = 'uuid-1234'
      const data = Buffer.from('chunk data here')

      sendBinaryChunk(mockSocket, transferId, 0, data)

      const header = writtenBuffers[0]
      const totalLen = header.readUInt32BE(2) // After magic bytes

      // totalLen = type(1) + tidLen(2) + tid(n) + idx(4) + data(m)
      const expectedTotalLen = 1 + 2 + Buffer.from(transferId).length + 4 + data.length
      expect(totalLen).toBe(expectedTotalLen)
    })

    it('should throw error when socket is not writable', () => {
      ;(mockSocket as any).writable = false

      expect(() => sendBinaryChunk(mockSocket, 'test-id', 0, Buffer.from('data'))).toThrow('Socket is not writable')
    })

    it('should throw error when socket is destroyed', () => {
      ;(mockSocket as any).destroyed = true

      expect(() => sendBinaryChunk(mockSocket, 'test-id', 0, Buffer.from('data'))).toThrow('Socket is not writable')
    })
  })

  describe('BINARY_TYPE_FILE_CHUNK', () => {
    it('should be 0x01', () => {
      expect(BINARY_TYPE_FILE_CHUNK).toBe(0x01)
    })
  })
})
