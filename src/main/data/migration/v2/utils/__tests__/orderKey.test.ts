import { describe, expect, it } from 'vitest'

import { assignOrderKeysByScope, assignOrderKeysInSequence } from '../orderKey'

describe('assignOrderKeysInSequence', () => {
  it('returns [] for empty input', () => {
    expect(assignOrderKeysInSequence([])).toEqual([])
  })

  it('assigns strictly increasing keys and preserves fields', () => {
    const input = [{ a: 1 }, { a: 2 }, { a: 3 }]
    const result = assignOrderKeysInSequence(input)

    expect(result).toHaveLength(3)
    expect(result[0].a).toBe(1)
    expect(result[1].a).toBe(2)
    expect(result[2].a).toBe(3)
    for (const row of result) {
      expect(typeof row.orderKey).toBe('string')
      expect(row.orderKey.length).toBeGreaterThan(0)
    }
    expect(result[0].orderKey < result[1].orderKey).toBe(true)
    expect(result[1].orderKey < result[2].orderKey).toBe(true)
  })

  it('does not mutate the input array or its elements', () => {
    const input = [{ a: 1 }, { a: 2 }, { a: 3 }]
    const snapshot = JSON.parse(JSON.stringify(input))

    assignOrderKeysInSequence(input)

    expect(input).toEqual(snapshot)
  })

  it('preserves all other fields on returned rows', () => {
    const input = [
      { id: 'x', label: 'foo', count: 10 },
      { id: 'y', label: 'bar', count: 20 }
    ]
    const result = assignOrderKeysInSequence(input)

    expect(result[0]).toMatchObject({ id: 'x', label: 'foo', count: 10 })
    expect(result[1]).toMatchObject({ id: 'y', label: 'bar', count: 20 })
  })
})

describe('assignOrderKeysByScope', () => {
  it('returns [] for empty input', () => {
    expect(assignOrderKeysByScope([], () => 'scope')).toEqual([])
  })

  it('behaves like assignOrderKeysInSequence for a single-scope bucket', () => {
    const input = [{ a: 1 }, { a: 2 }, { a: 3 }]
    const scoped = assignOrderKeysByScope(input, () => 'only')
    const flat = assignOrderKeysInSequence(input)

    expect(scoped).toEqual(flat)
  })

  it('assigns strictly increasing keys within each scope independently', () => {
    const input = [
      { id: 'a1', scope: 'A' },
      { id: 'a2', scope: 'A' },
      { id: 'b1', scope: 'B' },
      { id: 'b2', scope: 'B' },
      { id: 'b3', scope: 'B' }
    ]
    const result = assignOrderKeysByScope(input, (r) => r.scope)

    const a = result.filter((r) => r.scope === 'A')
    const b = result.filter((r) => r.scope === 'B')

    expect(a[0].orderKey < a[1].orderKey).toBe(true)
    expect(b[0].orderKey < b[1].orderKey).toBe(true)
    expect(b[1].orderKey < b[2].orderKey).toBe(true)
  })

  it('maintains input order in the output array (interleaved scopes)', () => {
    const input = [
      { id: 'a1', scope: 'A' },
      { id: 'b1', scope: 'B' },
      { id: 'a2', scope: 'A' }
    ]
    const result = assignOrderKeysByScope(input, (r) => r.scope)

    expect(result.map((r) => r.id)).toEqual(['a1', 'b1', 'a2'])

    // Keys within scope A (positions 0 and 2) must be strictly increasing.
    const a1Key = result[0].orderKey
    const a2Key = result[2].orderKey
    expect(a1Key < a2Key).toBe(true)

    // Scope B has a single entry; key just needs to be non-empty.
    expect(result[1].orderKey.length).toBeGreaterThan(0)
  })

  it('gives a single-row bucket a valid non-empty key', () => {
    const input = [
      { id: 'x', scope: 'solo' },
      { id: 'a', scope: 'multi' },
      { id: 'b', scope: 'multi' }
    ]
    const result = assignOrderKeysByScope(input, (r) => r.scope)

    const solo = result.find((r) => r.id === 'x')
    expect(solo).toBeDefined()
    expect(typeof solo!.orderKey).toBe('string')
    expect(solo!.orderKey.length).toBeGreaterThan(0)
  })

  it('does not mutate the input array or its elements', () => {
    const input = [
      { id: 'a1', scope: 'A' },
      { id: 'b1', scope: 'B' },
      { id: 'a2', scope: 'A' }
    ]
    const snapshot = JSON.parse(JSON.stringify(input))

    assignOrderKeysByScope(input, (r) => r.scope)

    expect(input).toEqual(snapshot)
  })

  it('preserves all other fields on returned rows', () => {
    const input = [
      { id: 'a1', scope: 'A', label: 'foo', count: 10 },
      { id: 'b1', scope: 'B', label: 'bar', count: 20 }
    ]
    const result = assignOrderKeysByScope(input, (r) => r.scope)

    const a1 = result.find((r) => r.id === 'a1')!
    const b1 = result.find((r) => r.id === 'b1')!
    expect(a1).toMatchObject({ id: 'a1', scope: 'A', label: 'foo', count: 10 })
    expect(b1).toMatchObject({ id: 'b1', scope: 'B', label: 'bar', count: 20 })
  })
})
