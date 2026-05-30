import { describe, expect, it, vi } from 'vitest'

import { Signal } from '../signal'

describe('Signal', () => {
  describe('resolve', () => {
    it('should notify listener on resolve', () => {
      const signal = new Signal<number>()
      const listener = vi.fn()

      signal.onResolved(listener)
      signal.resolve(42)

      expect(listener).toHaveBeenCalledWith(42)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should resolve the promise for await', async () => {
      const signal = new Signal<string>()

      setTimeout(() => signal.resolve('done'), 0)
      const result = await signal

      expect(result).toBe('done')
    })

    it('should throw on double resolve', () => {
      const signal = new Signal<number>()
      signal.resolve(1)
      expect(() => signal.resolve(2)).toThrow('Signal has already been resolved')
    })

    it('should be a no-op if disposed before resolve', () => {
      const signal = new Signal<number>()
      const listener = vi.fn()

      signal.onResolved(listener)
      signal.dispose()
      signal.resolve(42)

      expect(listener).not.toHaveBeenCalled()
      expect(signal.isResolved).toBe(false)
    })
  })

  describe('late subscriber', () => {
    it('should call late subscriber immediately with resolved value', () => {
      const signal = new Signal<number>()
      signal.resolve(42)

      const listener = vi.fn()
      signal.onResolved(listener)

      expect(listener).toHaveBeenCalledWith(42)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should return no-op disposable for late subscriber', () => {
      const signal = new Signal<number>()
      signal.resolve(42)

      const listener = vi.fn()
      const subscription = signal.onResolved(listener)

      // dispose should not throw
      subscription.dispose()
    })
  })

  describe('isResolved', () => {
    it('should be false before resolve', () => {
      const signal = new Signal<number>()
      expect(signal.isResolved).toBe(false)
    })

    it('should be true after resolve', () => {
      const signal = new Signal<number>()
      signal.resolve(42)
      expect(signal.isResolved).toBe(true)
    })
  })

  describe('value', () => {
    it('should return resolved value', () => {
      const signal = new Signal<number>()
      signal.resolve(42)
      expect(signal.value).toBe(42)
    })

    it('should throw if accessed before resolve', () => {
      const signal = new Signal<number>()
      expect(() => signal.value).toThrow('Signal has not been resolved yet')
    })
  })

  describe('then (PromiseLike)', () => {
    it('should be thenable', async () => {
      const signal = new Signal<number>()
      signal.resolve(10)

      const result = await signal.then((v) => v * 2)
      expect(result).toBe(20)
    })

    it('should work with Promise.all', async () => {
      const signal1 = new Signal<number>()
      const signal2 = new Signal<string>()

      signal1.resolve(1)
      signal2.resolve('two')

      const results = await Promise.all([signal1, signal2])
      expect(results).toEqual([1, 'two'])
    })
  })

  describe('dispose', () => {
    it('should stop notifying new subscribers after dispose', () => {
      const signal = new Signal<number>()
      signal.dispose()

      const listener = vi.fn()
      signal.onResolved(listener)

      // Signal is disposed and not resolved, so late-subscriber path doesn't apply
      expect(listener).not.toHaveBeenCalled()
    })

    it('should not call late subscriber if disposed after resolve', () => {
      const signal = new Signal<number>()
      signal.resolve(42)
      signal.dispose()

      const listener = vi.fn()
      signal.onResolved(listener)

      // Disposed after resolve: late subscriber should not be called
      expect(listener).not.toHaveBeenCalled()
    })
  })
})
