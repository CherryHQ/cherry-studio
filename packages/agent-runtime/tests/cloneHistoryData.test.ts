import { expect, it } from 'vitest'

import { cloneHistoryData } from '../src'

it('isolates mutable history containers while preserving cycles and shared references', () => {
  const child = { bytes: new Uint8Array([1, 2]), date: new Date(0), items: ['original'] }
  const source: { first: typeof child; second: typeof child; self?: unknown; error: Error } = {
    first: child,
    second: child,
    error: new Error('failed', { cause: { retry: true } })
  }
  source.self = source
  const captured = cloneHistoryData(source)
  captured.first.bytes[0] = 9
  captured.first.date.setTime(1000)
  captured.first.items.push('changed')
  Object.assign(captured.error.cause!, { retry: false })

  expect(captured.self).toBe(captured)
  expect(captured.first).toBe(captured.second)
  expect(source.first.bytes[0]).toBe(1)
  expect(source.first.date.getTime()).toBe(0)
  expect(source.first.items).toEqual(['original'])
  expect(source.error.cause).toEqual({ retry: true })
})

it.each([() => {}, Symbol('unsupported')])('rejects unsupported payloads instead of forwarding them: %s', (value) => {
  expect(() => cloneHistoryData({ value })).toThrow(expect.objectContaining({ name: 'DataCloneError' }))
})
