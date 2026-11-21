import { describe, expect, it } from 'vitest'

import { deepMergeObjects } from '..'

describe('provider settings merge', () => {
  it('preserves reserved own fields at each depth without changing object prototypes', () => {
    const target = Object.freeze({ nested: Object.freeze({ retained: true }) })
    const source = Object.freeze(JSON.parse('{"__proto__":{"root":"value"},"nested":{"__proto__":{"leaf":"value"}}}'))

    const result = deepMergeObjects(target, source)

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({ root: 'value' })
    expect(Object.getPrototypeOf(result.nested)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(result.nested, '__proto__')?.value).toEqual({ leaf: 'value' })
    expect(result.nested.retained).toBe(true)
    expect(Object.hasOwn(target.nested, '__proto__')).toBe(false)
  })

  it('retains callback identity, target symbols and untouched nested defaults', () => {
    const metadata = Symbol('provider metadata')
    const previousFetch = () => 'previous'
    const nextFetch = () => 'next'
    const nativeMetadata = { label: 'native' }
    const target = Object.freeze({
      fetch: previousFetch,
      nested: Object.freeze({ retained: true }),
      [metadata]: nativeMetadata
    })
    const source = Object.freeze({ fetch: nextFetch, nested: Object.freeze({ added: true }) })

    const result = deepMergeObjects(target, source)

    expect(result.fetch).toBe(nextFetch)
    expect(result[metadata]).toBe(nativeMetadata)
    expect(result.nested).toEqual({ retained: true, added: true })
    expect(target.fetch).toBe(previousFetch)
    expect(target.nested).toEqual({ retained: true })
  })
})
