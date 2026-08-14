import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResponseManager } from '../responseManager'

describe('ResponseManager', () => {
  let manager: ResponseManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new ResponseManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('buildResponseKey', () => {
    it('should build key with type only', () => {
      expect(manager.buildResponseKey('handshake_ack')).toBe('handshake_ack')
    })

    it('should build key with type and transferId', () => {
      expect(manager.buildResponseKey('file_start_ack', 'uuid-123')).toBe('file_start_ack:uuid-123')
    })

    it('should build key with type, transferId, and chunkIndex', () => {
      expect(manager.buildResponseKey('file_chunk_ack', 'uuid-123', 5)).toBe('file_chunk_ack:uuid-123:5')
    })
  })

  describe('waitForResponse', () => {
    it('should resolve when tryResolve is called with matching key', async () => {
      const resolvePromise = new Promise<unknown>((resolve, reject) => {
        manager.waitForResponse('handshake_ack', 5000, resolve, reject)
      })

      const payload = { type: 'handshake_ack', accepted: true }
      const resolved = manager.tryResolve('handshake_ack', payload)

      expect(resolved).toBe(true)
      await expect(resolvePromise).resolves.toEqual(payload)
    })

    it('should reject on timeout', async () => {
      const resolvePromise = new Promise<unknown>((resolve, reject) => {
        manager.waitForResponse('handshake_ack', 1000, resolve, reject)
      })

      vi.advanceTimersByTime(1001)

      await expect(resolvePromise).rejects.toThrow('Timeout waiting for handshake_ack')
    })

    it('should call onTimeout callback when timeout occurs', async () => {
      const onTimeout = vi.fn()
      manager.setTimeoutCallback(onTimeout)

      const resolvePromise = new Promise<unknown>((resolve, reject) => {
        manager.waitForResponse('test', 1000, resolve, reject)
      })

      vi.advanceTimersByTime(1001)

      await expect(resolvePromise).rejects.toThrow()
      expect(onTimeout).toHaveBeenCalled()
    })

    it('should reject when abort signal is triggered', async () => {
      const abortController = new AbortController()

      const resolvePromise = new Promise<unknown>((resolve, reject) => {
        manager.waitForResponse('test', 10000, resolve, reject, undefined, undefined, abortController.signal)
      })

      abortController.abort(new Error('User cancelled'))

      await expect(resolvePromise).rejects.toThrow('User cancelled')
    })

    it('should replace existing response with same key', async () => {
      const firstReject = vi.fn()
      const secondResolve = vi.fn()
      const secondReject = vi.fn()

      manager.waitForResponse('test', 5000, vi.fn(), firstReject)
      manager.waitForResponse('test', 5000, secondResolve, secondReject)

      // First should be cleared (no rejection since it's replaced)
      const payload = { type: 'test' }
      manager.tryResolve('test', payload)

      expect(secondResolve).toHaveBeenCalledWith(payload)
    })
  })

  describe('tryResolve', () => {
    it('should return false when no matching response', () => {
      expect(manager.tryResolve('nonexistent', {})).toBe(false)
    })

    it('should match with transferId', async () => {
      const resolvePromise = new Promise<unknown>((resolve, reject) => {
        manager.waitForResponse('file_start_ack', 5000, resolve, reject, 'uuid-123')
      })

      const payload = { type: 'file_start_ack', transferId: 'uuid-123' }
      manager.tryResolve('file_start_ack', payload, 'uuid-123')

      await expect(resolvePromise).resolves.toEqual(payload)
    })
  })

  describe('rejectAll', () => {
    it('should reject all pending responses', async () => {
      const promises = [
        new Promise<unknown>((resolve, reject) => {
          manager.waitForResponse('test1', 5000, resolve, reject)
        }),
        new Promise<unknown>((resolve, reject) => {
          manager.waitForResponse('test2', 5000, resolve, reject, 'uuid')
        })
      ]

      manager.rejectAll(new Error('Connection closed'))

      await expect(promises[0]).rejects.toThrow('Connection closed')
      await expect(promises[1]).rejects.toThrow('Connection closed')
    })
  })

  describe('clearPendingResponse', () => {
    it('should clear specific response by key', () => {
      manager.waitForResponse('test', 5000, vi.fn(), vi.fn())

      manager.clearPendingResponse('test')

      expect(manager.tryResolve('test', {})).toBe(false)
    })

    it('should clear all responses when no key provided', () => {
      manager.waitForResponse('test1', 5000, vi.fn(), vi.fn())
      manager.waitForResponse('test2', 5000, vi.fn(), vi.fn())

      manager.clearPendingResponse()

      expect(manager.tryResolve('test1', {})).toBe(false)
      expect(manager.tryResolve('test2', {})).toBe(false)
    })
  })

  describe('getAbortError', () => {
    it('should return Error reason directly', () => {
      const originalError = new Error('Original error')
      const signal = { aborted: true, reason: originalError } as AbortSignal

      const error = manager.getAbortError(signal, 'Fallback')

      expect(error).toBe(originalError)
    })

    it('should create Error from string reason', () => {
      const signal = { aborted: true, reason: 'String reason' } as AbortSignal

      const error = manager.getAbortError(signal, 'Fallback')

      expect(error.message).toBe('String reason')
    })

    it('should use fallback message when no reason', () => {
      const signal = { aborted: true } as AbortSignal

      const error = manager.getAbortError(signal, 'Fallback message')

      expect(error.message).toBe('Fallback message')
    })
  })
})
