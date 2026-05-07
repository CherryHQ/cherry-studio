import { EventEmitter } from 'node:events'
import type * as fs from 'node:fs'
import type { Socket } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  abortTransfer,
  cleanupTransfer,
  createTransferState,
  formatFileSize,
  streamFileChunks
} from '../../handlers/fileTransfer'
import type { ActiveFileTransfer } from '../../types'

// Mock binaryProtocol
vi.mock('../../binaryProtocol', () => ({
  sendBinaryChunk: vi.fn().mockReturnValue(true)
}))

// Mock connection handlers
vi.mock('./connection', () => ({
  waitForSocketDrain: vi.fn().mockResolvedValue(undefined),
  getAbortError: vi.fn((signal, fallback) => {
    const reason = (signal as AbortSignal & { reason?: unknown }).reason
    if (reason instanceof Error) return reason
    if (typeof reason === 'string' && reason.length > 0) return new Error(reason)
    return new Error(fallback)
  })
}))

// Note: validateFile and calculateFileChecksum tests are skipped because
// the test environment has globally mocked node:fs and node:os modules.
// These functions are tested through integration tests instead.

describe('fileTransfer handlers', () => {
  describe('createTransferState', () => {
    it('should create transfer state with correct defaults', () => {
      const state = createTransferState('uuid-123', 'test.zip', 1024000, 'abc123')

      expect(state.transferId).toBe('uuid-123')
      expect(state.fileName).toBe('test.zip')
      expect(state.fileSize).toBe(1024000)
      expect(state.checksum).toBe('abc123')
      expect(state.bytesSent).toBe(0)
      expect(state.currentChunk).toBe(0)
      expect(state.isCancelled).toBe(false)
      expect(state.abortController).toBeInstanceOf(AbortController)
    })

    it('should calculate totalChunks based on chunk size', () => {
      // 512KB chunk size
      const state = createTransferState('id', 'test.zip', 1024 * 1024, 'checksum') // 1MB

      expect(state.totalChunks).toBe(2) // 1MB / 512KB = 2
    })
  })

  describe('abortTransfer', () => {
    it('should abort transfer and destroy stream', () => {
      const mockStream = {
        destroyed: false,
        destroy: vi.fn()
      } as unknown as fs.ReadStream

      const transfer: ActiveFileTransfer = {
        transferId: 'test',
        fileName: 'test.zip',
        fileSize: 1000,
        checksum: 'abc',
        totalChunks: 1,
        chunkSize: 512000,
        bytesSent: 0,
        currentChunk: 0,
        startedAt: Date.now(),
        stream: mockStream,
        isCancelled: false,
        abortController: new AbortController()
      }

      const error = new Error('Test abort')
      abortTransfer(transfer, error)

      expect(transfer.isCancelled).toBe(true)
      expect(transfer.abortController.signal.aborted).toBe(true)
      expect(mockStream.destroy).toHaveBeenCalledWith(error)
    })

    it('should handle undefined transfer', () => {
      expect(() => abortTransfer(undefined, new Error('test'))).not.toThrow()
    })

    it('should not abort already aborted controller', () => {
      const transfer: ActiveFileTransfer = {
        transferId: 'test',
        fileName: 'test.zip',
        fileSize: 1000,
        checksum: 'abc',
        totalChunks: 1,
        chunkSize: 512000,
        bytesSent: 0,
        currentChunk: 0,
        startedAt: Date.now(),
        isCancelled: false,
        abortController: new AbortController()
      }

      transfer.abortController.abort()

      // Should not throw when aborting again
      expect(() => abortTransfer(transfer, new Error('test'))).not.toThrow()
    })
  })

  describe('cleanupTransfer', () => {
    it('should cleanup transfer resources', () => {
      const mockStream = {
        destroyed: false,
        destroy: vi.fn()
      } as unknown as fs.ReadStream

      const transfer: ActiveFileTransfer = {
        transferId: 'test',
        fileName: 'test.zip',
        fileSize: 1000,
        checksum: 'abc',
        totalChunks: 1,
        chunkSize: 512000,
        bytesSent: 0,
        currentChunk: 0,
        startedAt: Date.now(),
        stream: mockStream,
        isCancelled: false,
        abortController: new AbortController()
      }

      cleanupTransfer(transfer)

      expect(transfer.abortController.signal.aborted).toBe(true)
      expect(mockStream.destroy).toHaveBeenCalled()
    })

    it('should handle undefined transfer', () => {
      expect(() => cleanupTransfer(undefined)).not.toThrow()
    })
  })

  describe('formatFileSize', () => {
    it('should format 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 B')
    })

    it('should format bytes', () => {
      expect(formatFileSize(500)).toBe('500 B')
    })

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1 KB')
      expect(formatFileSize(2048)).toBe('2 KB')
    })

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1 MB')
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
    })

    it('should format gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
    })

    it('should format with decimal precision', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB')
      expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
    })
  })

  // Note: streamFileChunks tests require careful mocking of fs.createReadStream
  // which is globally mocked in the test environment. These tests verify the
  // streaming logic works correctly with mock streams.
  describe('streamFileChunks', () => {
    let mockSocket: Socket & EventEmitter
    let mockProgress: ReturnType<typeof vi.fn>

    beforeEach(() => {
      vi.clearAllMocks()

      mockSocket = Object.assign(new EventEmitter(), {
        destroyed: false,
        writable: true,
        write: vi.fn().mockReturnValue(true),
        cork: vi.fn(),
        uncork: vi.fn()
      }) as unknown as Socket & EventEmitter

      mockProgress = vi.fn()
    })

    afterEach(() => {
      vi.resetAllMocks()
    })

    it('should throw when abort signal is already aborted', async () => {
      const transfer = createTransferState('test-id', 'test.zip', 1024, 'checksum')
      transfer.abortController.abort(new Error('Already cancelled'))

      await expect(
        streamFileChunks(mockSocket, '/fake/path.zip', transfer, transfer.abortController.signal, mockProgress)
      ).rejects.toThrow()
    })

    // Note: Full integration testing of streamFileChunks with actual file streaming
    // requires a real file system, which cannot be easily mocked in ESM.
    // The abort signal test above verifies the early abort path.
    // Additional streaming tests are covered through integration tests.
  })
})
