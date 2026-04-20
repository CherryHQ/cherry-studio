import { describe, expect, it, vi } from 'vitest'

import { Emitter, toDisposable } from '../event'

describe('toDisposable', () => {
  it('should wrap a function as a Disposable', () => {
    const fn = vi.fn()
    const disposable = toDisposable(fn)
    expect(fn).not.toHaveBeenCalled()
    disposable.dispose()
    expect(fn).toHaveBeenCalledOnce()
  })

  it('should be idempotent — multiple dispose() calls only execute fn once', () => {
    const fn = vi.fn()
    const disposable = toDisposable(fn)
    disposable.dispose()
    disposable.dispose()
    disposable.dispose()
    expect(fn).toHaveBeenCalledOnce()
  })
})

describe('Emitter', () => {
  describe('fire and subscribe', () => {
    it('should notify listener when fired', () => {
      const emitter = new Emitter<number>()
      const listener = vi.fn()

      emitter.event(listener)
      emitter.fire(42)

      expect(listener).toHaveBeenCalledWith(42)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should notify multiple listeners', () => {
      const emitter = new Emitter<string>()
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      emitter.event(listener1)
      emitter.event(listener2)
      emitter.fire('hello')

      expect(listener1).toHaveBeenCalledWith('hello')
      expect(listener2).toHaveBeenCalledWith('hello')
    })

    it('should fire multiple times', () => {
      const emitter = new Emitter<number>()
      const listener = vi.fn()

      emitter.event(listener)
      emitter.fire(1)
      emitter.fire(2)
      emitter.fire(3)

      expect(listener).toHaveBeenCalledTimes(3)
      expect(listener).toHaveBeenNthCalledWith(1, 1)
      expect(listener).toHaveBeenNthCalledWith(2, 2)
      expect(listener).toHaveBeenNthCalledWith(3, 3)
    })
  })

  describe('unsubscribe via dispose', () => {
    it('should stop receiving events after dispose', () => {
      const emitter = new Emitter<number>()
      const listener = vi.fn()

      const subscription = emitter.event(listener)
      emitter.fire(1)
      subscription.dispose()
      emitter.fire(2)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(1)
    })

    it('should only unsubscribe the disposed listener', () => {
      const emitter = new Emitter<number>()
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const sub1 = emitter.event(listener1)
      emitter.event(listener2)

      sub1.dispose()
      emitter.fire(42)

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledWith(42)
    })
  })

  describe('emitter dispose', () => {
    it('should clear all listeners on dispose', () => {
      const emitter = new Emitter<number>()
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      emitter.event(listener1)
      emitter.event(listener2)
      emitter.dispose()
      emitter.fire(42)

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).not.toHaveBeenCalled()
    })

    it('should return no-op disposable for late subscribe after dispose', () => {
      const emitter = new Emitter<number>()
      emitter.dispose()

      const listener = vi.fn()
      const subscription = emitter.event(listener)
      emitter.fire(42)

      expect(listener).not.toHaveBeenCalled()
      // dispose should not throw
      subscription.dispose()
    })

    it('should set isDisposed to true', () => {
      const emitter = new Emitter<number>()
      expect(emitter.isDisposed).toBe(false)
      emitter.dispose()
      expect(emitter.isDisposed).toBe(true)
    })
  })

  describe('listenerCount', () => {
    it('should track listener count', () => {
      const emitter = new Emitter<number>()
      expect(emitter.listenerCount).toBe(0)

      const sub1 = emitter.event(vi.fn())
      expect(emitter.listenerCount).toBe(1)

      const sub2 = emitter.event(vi.fn())
      expect(emitter.listenerCount).toBe(2)

      sub1.dispose()
      expect(emitter.listenerCount).toBe(1)

      sub2.dispose()
      expect(emitter.listenerCount).toBe(0)
    })

    it('should be 0 after emitter dispose', () => {
      const emitter = new Emitter<number>()
      emitter.event(vi.fn())
      emitter.event(vi.fn())
      emitter.dispose()
      expect(emitter.listenerCount).toBe(0)
    })
  })

  describe('error isolation', () => {
    it('should continue notifying other listeners when one throws', () => {
      const emitter = new Emitter<number>()
      const badListener = vi.fn(() => {
        throw new Error('bad')
      })
      const goodListener = vi.fn()

      emitter.event(badListener)
      emitter.event(goodListener)
      emitter.fire(42)

      expect(badListener).toHaveBeenCalledWith(42)
      expect(goodListener).toHaveBeenCalledWith(42)
    })
  })

  describe('mutation during fire', () => {
    it('should handle listener unsubscribing itself during fire', () => {
      const emitter = new Emitter<number>()
      const listener2 = vi.fn()

      const subscription = { current: null as { dispose(): void } | null }
      const listener1 = vi.fn(() => {
        subscription.current?.dispose()
      })

      subscription.current = emitter.event(listener1)
      emitter.event(listener2)
      emitter.fire(42)

      expect(listener1).toHaveBeenCalledWith(42)
      expect(listener2).toHaveBeenCalledWith(42)
    })
  })
})
