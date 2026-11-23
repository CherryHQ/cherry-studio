import { describe, expect, it } from 'vitest'

import { Signal } from '../signal'

describe('Signal', () => {
  describe('resolve', () => {
    it('should notify listener on resolve', () => {
      const signal = new Signal<number>()
      const received: number[] = []

      signal.onResolved((value) => received.push(value))
      signal.resolve(42)

      expect(received).toEqual([42])
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
      const received: number[] = []

      signal.onResolved((value) => received.push(value))
      signal.dispose()
      signal.resolve(42)

      expect(received).toEqual([])
      expect(signal.isResolved).toBe(false)
    })
  })

  describe('late subscriber', () => {
    it('should call late subscriber immediately with resolved value', () => {
      const signal = new Signal<number>()
      signal.resolve(42)

      const received: number[] = []
      signal.onResolved((value) => received.push(value))

      expect(received).toEqual([42])
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
    it.each([undefined, null, false, 0, ''])(
      'retains the resolved value %s across every observation path',
      async (value) => {
        const signal = new Signal<typeof value>()
        const early: Array<typeof value> = []
        const late: Array<typeof value> = []

        signal.onResolved((received) => early.push(received))
        signal.resolve(value)
        signal.onResolved((received) => late.push(received))

        expect(signal.isResolved).toBe(true)
        expect(signal.value).toBe(value)
        await expect(Promise.resolve(signal)).resolves.toBe(value)
        expect(early).toEqual([value])
        expect(late).toEqual([value])
      }
    )

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

      const received: number[] = []
      signal.onResolved((value) => received.push(value))

      expect(received).toEqual([])
    })

    it('retains the resolved value after disposal without notifying late subscribers', async () => {
      const signal = new Signal<number>()
      signal.resolve(42)
      signal.dispose()

      const received: number[] = []
      signal.onResolved((value) => received.push(value))

      expect(received).toEqual([])
      expect(signal.value).toBe(42)
      await expect(Promise.resolve(signal)).resolves.toBe(42)
    })
  })
})
