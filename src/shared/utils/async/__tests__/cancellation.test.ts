import { setTimeout as sleep } from 'node:timers/promises'

import { describe, expect, it, vi } from 'vitest'

import { createAbortError, isAbortError, onAbort, timeoutSignal } from '..'

describe('onAbort', () => {
  it('leaves an absent signal inert across repeated detachment', () => {
    const delivered: unknown[] = []
    const detach = onAbort(undefined, (reason) => delivered.push(reason))

    detach()
    detach()

    expect(delivered).toEqual([])
  })

  it.each([new Error('owner stopped'), null, 'owner stopped', 0])(
    'delivers an already-aborted reason synchronously and unchanged: %s',
    (reason) => {
      const controller = new AbortController()
      controller.abort(reason)
      const delivered: unknown[] = []

      const detach = onAbort(controller.signal, (value) => delivered.push(value))

      expect(delivered).toHaveLength(1)
      expect(delivered[0]).toBe(reason)
      detach()
      detach()
      controller.signal.dispatchEvent(new Event('abort'))
      expect(delivered).toHaveLength(1)
    }
  )

  it('delivers a future abort once and releases its event subscription', () => {
    const controller = new AbortController()
    const reason = new Error('owner stopped')
    const delivered: unknown[] = []
    const detach = onAbort(controller.signal, (value) => delivered.push(value))
    expect(delivered).toEqual([])

    controller.abort(reason)
    controller.signal.dispatchEvent(new Event('abort'))
    detach()
    detach()

    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toBe(reason)
  })

  it('detaches only its callback without aborting the signal or removing other observers', () => {
    const controller = new AbortController()
    const delivered: string[] = []
    controller.signal.addEventListener('abort', () => delivered.push('other'), { once: true })
    const detach = onAbort(controller.signal, () => delivered.push('detached'))

    detach()
    detach()
    expect(controller.signal.aborted).toBe(false)
    controller.abort()

    expect(delivered).toEqual(['other'])
  })

  it('does not swallow an immediate callback failure', () => {
    const failure = new Error('owner callback failed')

    expect(() =>
      onAbort(AbortSignal.abort(), () => {
        throw failure
      })
    ).toThrow(failure)
  })
})

describe('timeoutSignal', () => {
  it.each([new Error('owner stopped'), null])('preserves an already-aborted parent reason: %s', (reason) => {
    const signal = timeoutSignal(10, AbortSignal.abort(reason))

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe(reason)
  })

  it.each([-1, NaN, Infinity])('retains native timeout validation even with an aborted parent: %s', (timeoutMs) => {
    expect(() => timeoutSignal(timeoutMs, AbortSignal.abort(null))).toThrow()
  })

  it('keeps the parent reason after the later deadline expires', async () => {
    const parent = new AbortController()
    const signal = timeoutSignal(10, parent.signal)
    const reason = new Error('owner stopped')

    parent.abort(reason)
    expect(signal.reason).toBe(reason)
    await sleep(25)

    expect(signal.reason).toBe(reason)
  })

  it('keeps the native timeout reason after later parent cancellation', async () => {
    const parent = new AbortController()
    const signal = timeoutSignal(10, parent.signal)

    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    const reason = signal.reason
    expect(reason).toBeInstanceOf(DOMException)
    expect(reason.name).toBe('TimeoutError')

    parent.abort(new Error('owner stopped'))
    expect(signal.reason).toBe(reason)
  })

  it('expires with a native TimeoutError when there is no parent', async () => {
    const signal = timeoutSignal(10)
    expect(signal.aborted).toBe(false)

    await vi.waitFor(() => expect(signal.aborted).toBe(true))

    expect(signal.reason).toBeInstanceOf(DOMException)
    expect(signal.reason.name).toBe('TimeoutError')
  })
})

describe('isAbortError', () => {
  it.each([
    ['ordinary Error', Object.assign(new Error('stopped'), { name: 'AbortError' })],
    ['DOMException', new DOMException('stopped', 'AbortError')],
    ['serialized error', { name: 'AbortError', message: 'stopped' }],
    ['inherited name', Object.create({ name: 'AbortError' })]
  ])('recognizes an exact AbortError name on %s', (_label, error) => {
    expect(isAbortError(error)).toBe(true)
  })

  it.each([
    null,
    undefined,
    'AbortError',
    {},
    { name: 1 },
    { name: 'aborterror' },
    new Error('The operation was aborted'),
    new DOMException('deadline', 'TimeoutError'),
    { name: 'ResponseAborted' },
    function AbortError() {
      return null
    }
  ])('does not widen cancellation to unrelated values: %s', (error) => {
    expect(isAbortError(error)).toBe(false)
  })
})

describe('createAbortError', () => {
  it('creates an ordinary Error with the exact caller message', () => {
    const error = createAbortError('Preview request cancelled: owner stopped')

    expect(Object.getPrototypeOf(error)).toBe(Error.prototype)
    expect(error.name).toBe('AbortError')
    expect(error.message).toBe('Preview request cancelled: owner stopped')
  })
})
