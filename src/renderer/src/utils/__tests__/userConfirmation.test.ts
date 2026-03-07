import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelToolAction,
  confirmSameNameTools,
  confirmToolAction,
  getPendingToolIds,
  isToolPending,
  onToolPendingChange,
  requestToolConfirmation,
  setToolIdToNameMapping
} from '../userConfirmation'

describe('userConfirmation', () => {
  beforeEach(() => {
    // Clear any pending resolvers by cancelling them
    for (const id of getPendingToolIds()) {
      cancelToolAction(id)
    }
  })

  afterEach(() => {
    for (const id of getPendingToolIds()) {
      cancelToolAction(id)
    }
  })

  describe('requestToolConfirmation', () => {
    it('resolves true when confirmed', async () => {
      const promise = requestToolConfirmation('tool-1')
      expect(isToolPending('tool-1')).toBe(true)

      confirmToolAction('tool-1')
      const result = await promise
      expect(result).toBe(true)
      expect(isToolPending('tool-1')).toBe(false)
    })

    it('resolves false when cancelled', async () => {
      const promise = requestToolConfirmation('tool-2')
      expect(isToolPending('tool-2')).toBe(true)

      cancelToolAction('tool-2')
      const result = await promise
      expect(result).toBe(false)
      expect(isToolPending('tool-2')).toBe(false)
    })

    it('resolves false immediately when abortSignal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      const result = await requestToolConfirmation('tool-3', controller.signal)
      expect(result).toBe(false)
      expect(isToolPending('tool-3')).toBe(false)
    })

    it('resolves false when abortSignal fires', async () => {
      const controller = new AbortController()
      const promise = requestToolConfirmation('tool-4', controller.signal)

      controller.abort()
      const result = await promise
      expect(result).toBe(false)
    })
  })

  describe('onToolPendingChange', () => {
    it('notifies listener when a tool becomes pending', async () => {
      const listener = vi.fn()
      const unsubscribe = onToolPendingChange(listener)

      const promise = requestToolConfirmation('tool-5')
      expect(listener).toHaveBeenCalledWith('tool-5')
      expect(listener).toHaveBeenCalledTimes(1)

      confirmToolAction('tool-5')
      await promise
      unsubscribe()
    })

    it('does not notify after unsubscribe', async () => {
      const listener = vi.fn()
      const unsubscribe = onToolPendingChange(listener)
      unsubscribe()

      const promise = requestToolConfirmation('tool-6')
      expect(listener).not.toHaveBeenCalled()

      confirmToolAction('tool-6')
      await promise
    })

    it('only notifies for the specific toolId', async () => {
      const listener = vi.fn()
      const unsubscribe = onToolPendingChange(listener)

      const p1 = requestToolConfirmation('tool-7')
      const p2 = requestToolConfirmation('tool-8')

      expect(listener).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenCalledWith('tool-7')
      expect(listener).toHaveBeenCalledWith('tool-8')

      confirmToolAction('tool-7')
      confirmToolAction('tool-8')
      await Promise.all([p1, p2])
      unsubscribe()
    })
  })

  describe('getPendingToolIds', () => {
    it('returns all pending tool ids excluding _global', async () => {
      const p1 = requestToolConfirmation('tool-a')
      const p2 = requestToolConfirmation('tool-b')

      const ids = getPendingToolIds()
      expect(ids).toContain('tool-a')
      expect(ids).toContain('tool-b')
      expect(ids).not.toContain('_global')

      confirmToolAction('tool-a')
      confirmToolAction('tool-b')
      await Promise.all([p1, p2])
    })
  })

  describe('confirmSameNameTools', () => {
    it('confirms all pending tools with the same name', async () => {
      setToolIdToNameMapping('id-1', 'search')
      setToolIdToNameMapping('id-2', 'search')
      setToolIdToNameMapping('id-3', 'query')

      const p1 = requestToolConfirmation('id-1')
      const p2 = requestToolConfirmation('id-2')
      const p3 = requestToolConfirmation('id-3')

      confirmSameNameTools('search')

      expect(await p1).toBe(true)
      expect(await p2).toBe(true)
      expect(isToolPending('id-3')).toBe(true)

      confirmToolAction('id-3')
      await p3
    })
  })
})
