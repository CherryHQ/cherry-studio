import { expect, it } from 'vitest'

import { immutable } from '../src'

it('freezes a copy without freezing the caller, preserving cycles and shared references', () => {
  const child = { bytes: new Uint8Array([1, 2]), date: new Date(0), items: ['original'] }
  const source: { first: typeof child; second: typeof child; self?: unknown } = { first: child, second: child }
  source.self = source
  const frozen = immutable(source)
  source.first.items.push('caller edit')
  source.first.bytes[0] = 9

  expect(frozen.self).toBe(frozen)
  expect(frozen.first).toBe(frozen.second)
  expect(frozen.first.items).toEqual(['original'])
  expect(frozen.first.bytes[0]).toBe(1)
  expect(Object.isFrozen(source)).toBe(false)
  expect(() => frozen.first.items.push('consumer edit')).toThrow(TypeError)
})

it('reuses values it already froze so republished data is shared instead of copied', () => {
  const message = immutable({ id: 'kept', parts: [{ type: 'text', text: 'body' }] })
  const next = immutable({ messages: [message, { id: 'new', parts: [] }] })

  expect(next.messages[0]).toBe(message)
  expect(immutable(next)).toBe(next)
})

it.each([() => {}, Symbol('unsupported')])('rejects unsupported payloads instead of forwarding them: %s', (value) => {
  expect(() => immutable({ value })).toThrow(expect.objectContaining({ name: 'DataCloneError' }))
})
