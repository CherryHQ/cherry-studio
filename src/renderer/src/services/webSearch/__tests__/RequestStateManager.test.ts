import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RequestStateManager } from '../RequestStateManager'

// Mock addAbortController
const mockAbortCallbacks = new Map<string, () => void>()
vi.mock('@renderer/utils/abortController', () => ({
  addAbortController: vi.fn((requestId: string, callback: () => void) => {
    mockAbortCallbacks.set(requestId, callback)
  })
}))

describe('RequestStateManager', () => {
  let manager: RequestStateManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockAbortCallbacks.clear()
    manager = new RequestStateManager()
  })

  describe('getRequestState', () => {
    it('should create new state for unknown request ID', () => {
      const state = manager.getRequestState('request-1')

      expect(state).toEqual({
        signal: null,
        isPaused: false,
        createdAt: expect.any(Number)
      })
    })

    it('should return existing state for known request ID', () => {
      const firstCall = manager.getRequestState('request-1')
      const secondCall = manager.getRequestState('request-1')

      expect(firstCall).toBe(secondCall)
      expect(firstCall.createdAt).toBe(secondCall.createdAt)
    })

    it('should create separate states for different request IDs', () => {
      const state1 = manager.getRequestState('request-1')
      const state2 = manager.getRequestState('request-2')

      expect(state1).not.toBe(state2)
    })
  })

  describe('createAbortSignal', () => {
    it('should create an AbortController and return it', () => {
      const controller = manager.createAbortSignal('request-1')

      expect(controller).toBeInstanceOf(AbortController)
      expect(controller.signal.aborted).toBe(false)
    })

    it('should associate signal with request state', () => {
      const controller = manager.createAbortSignal('request-1')
      const state = manager.getRequestState('request-1')

      expect(state.signal).toBe(controller.signal)
    })

    it('should store signal in manager', () => {
      const controller = manager.createAbortSignal('request-1')

      expect(manager.getSignal()).toBe(controller.signal)
    })

    it('should register abort callback', () => {
      manager.createAbortSignal('request-1')

      expect(mockAbortCallbacks.has('request-1')).toBe(true)
    })

    it('should handle abort callback correctly', () => {
      const onAbort = vi.fn()
      manager = new RequestStateManager(onAbort)

      const controller = manager.createAbortSignal('request-1')
      manager.getRequestState('request-1') // Ensure state exists

      // Trigger abort callback
      const callback = mockAbortCallbacks.get('request-1')
      callback?.()

      expect(manager.isPaused).toBe(true)
      expect(controller.signal.aborted).toBe(true)
      expect(onAbort).toHaveBeenCalledWith('request-1')
      expect(manager.getSignal()).toBeNull()
    })

    it('should set isPaused on state when aborted', () => {
      manager.createAbortSignal('request-1')
      manager.getRequestState('request-1') // Ensure state exists

      // Trigger abort callback
      const callback = mockAbortCallbacks.get('request-1')
      callback?.()

      // Note: The state is deleted, so we can't check it directly
      // But manager.isPaused should be true
      expect(manager.isPaused).toBe(true)
    })

    it('should delete request state when aborted', () => {
      manager.createAbortSignal('request-1')

      // Trigger abort callback
      const callback = mockAbortCallbacks.get('request-1')
      callback?.()

      // Getting state now should create a new one
      const newState = manager.getRequestState('request-1')
      expect(newState.isPaused).toBe(false) // New state, not the aborted one
    })
  })

  describe('clearRequestState', () => {
    it('should remove request state', () => {
      manager.getRequestState('request-1')
      manager.clearRequestState('request-1')

      // Getting state again should create a new one with different createdAt
      const beforeClear = Date.now()
      const newState = manager.getRequestState('request-1')

      expect(newState.createdAt).toBeGreaterThanOrEqual(beforeClear)
    })

    it('should not throw for non-existent request', () => {
      expect(() => manager.clearRequestState('non-existent')).not.toThrow()
    })
  })

  describe('getSignal', () => {
    it('should return null initially', () => {
      expect(manager.getSignal()).toBeNull()
    })

    it('should return the signal after createAbortSignal', () => {
      const controller = manager.createAbortSignal('request-1')

      expect(manager.getSignal()).toBe(controller.signal)
    })

    it('should return null after abort', () => {
      manager.createAbortSignal('request-1')

      // Trigger abort
      const callback = mockAbortCallbacks.get('request-1')
      callback?.()

      expect(manager.getSignal()).toBeNull()
    })
  })

  describe('isPaused', () => {
    it('should be false initially', () => {
      expect(manager.isPaused).toBe(false)
    })

    it('should be true after abort', () => {
      manager.createAbortSignal('request-1')

      // Trigger abort
      const callback = mockAbortCallbacks.get('request-1')
      callback?.()

      expect(manager.isPaused).toBe(true)
    })
  })

  describe('onAbort callback', () => {
    it('should call onAbort callback with request ID when aborted', () => {
      const onAbort = vi.fn()
      manager = new RequestStateManager(onAbort)

      manager.createAbortSignal('request-123')

      // Trigger abort
      const callback = mockAbortCallbacks.get('request-123')
      callback?.()

      expect(onAbort).toHaveBeenCalledWith('request-123')
    })

    it('should work without onAbort callback', () => {
      manager = new RequestStateManager() // No onAbort

      manager.createAbortSignal('request-1')

      // Should not throw
      const callback = mockAbortCallbacks.get('request-1')
      expect(() => callback?.()).not.toThrow()
    })
  })
})
