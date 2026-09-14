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
    // A cancelled transfer must not leave an acknowledgement waiter that later disconnects on timeout.
    it('rejects a pre-aborted response wait and removes its pending deadline', () => {
      const reason = new Error('Transfer cancelled before acknowledgement')
      const errors: Error[] = []
      let timeouts = 0
      manager.setTimeoutCallback(() => timeouts++)

      manager.waitForResponse(
        'file_start_ack',
        1000,
        () => {},
        (error) => errors.push(error),
        'transfer',
        undefined,
        AbortSignal.abort(reason)
      )

      expect(errors).toEqual([reason])
      expect(manager.tryResolve('file_start_ack', {}, 'transfer')).toBe(false)
      vi.advanceTimersByTime(1001)
      expect(errors).toEqual([reason])
      expect(timeouts).toBe(0)
    })

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

  // LAN callers must receive Error objects without losing an Error reason's identity.
  it.each([
    { reason: new Error('Original error'), message: 'Original error' },
    { reason: 'String reason', message: 'String reason' },
    { reason: null, message: 'Aborted while waiting for test' }
  ])('maps abort reason $reason for response waits', async ({ reason, message }) => {
    const controller = new AbortController()
    const result = new Promise<unknown>((resolve, reject) => {
      manager.waitForResponse('test', 5000, resolve, reject, undefined, undefined, controller.signal)
    })
    const outcome = result.catch((error: unknown) => error)

    controller.abort(reason)

    const error = await outcome
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message })
    if (reason instanceof Error) expect(error).toBe(reason)
    expect(manager.tryResolve('test', {})).toBe(false)
  })
})
