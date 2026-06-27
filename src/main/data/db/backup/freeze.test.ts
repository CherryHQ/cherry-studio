import { describe, expect, it } from 'vitest'

import { deepFreeze } from './freeze'

// deepFreeze freezes contributor constant object graphs at module load. These tests
// pin the edge cases documented in freeze.ts: primitives pass through, plain graphs are
// frozen recursively, non-plain values (Date/Map) are left intact, cycles do not overflow.

describe('deepFreeze', () => {
  it('returns primitives and null unchanged', () => {
    expect(deepFreeze(42)).toBe(42)
    expect(deepFreeze('text')).toBe('text')
    expect(deepFreeze(true)).toBe(true)
    expect(deepFreeze(null)).toBeNull()
    expect(deepFreeze(undefined)).toBeUndefined()
  })

  it('returns the same object reference it received (identity)', () => {
    const input = { a: 1 }
    expect(deepFreeze(input)).toBe(input)
  })

  it('freezes a plain object and every nested plain object', () => {
    const value = deepFreeze({ outer: { inner: { leaf: 1 } } })
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.outer)).toBe(true)
    expect(Object.isFrozen(value.outer.inner)).toBe(true)
  })

  it('freezes arrays and their object elements', () => {
    const value = deepFreeze([{ x: 1 }, [{ y: 2 }]])
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value[0])).toBe(true)
    expect(Object.isFrozen(value[1])).toBe(true)
  })

  it('leaves Date instances intact so runtime semantics stay usable', () => {
    const date = new Date()
    const wrapped = deepFreeze({ at: date })
    expect(Object.isFrozen(wrapped)).toBe(true)
    expect(Object.isFrozen(date)).toBe(false)
    expect(wrapped.at.getTime()).toBe(date.getTime())
  })

  it('leaves Map instances intact so runtime semantics stay usable', () => {
    const map = new Map([['k', 1]])
    const wrapped = deepFreeze({ m: map })
    expect(Object.isFrozen(wrapped)).toBe(true)
    expect(Object.isFrozen(map)).toBe(false)
    expect(wrapped.m.get('k')).toBe(1)
  })

  it('tolerates object cycles without stack overflow', () => {
    const node: Record<string, unknown> = { label: 'root' }
    node.self = node
    const frozen = deepFreeze(node)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.self)).toBe(true)
  })

  it('freezes symbol-keyed own properties', () => {
    const sym = Symbol('id')
    const value = deepFreeze({ [sym]: { n: 1 } })
    expect(Object.isFrozen(value)).toBe(true)
    const child = (value as Record<symbol, unknown>)[sym]
    expect(Object.isFrozen(child)).toBe(true)
  })

  it('preserves shared sub-object references (diamond) without duplication', () => {
    // The isFrozen guard doubles as cross-branch de-dup: a shared leaf is frozen once
    // and the second visit is a no-op, so identity is preserved (not two copies).
    const leaf = { n: 1 }
    const root = deepFreeze({ a: leaf, b: leaf })
    expect(root.a).toBe(root.b)
    expect(Object.isFrozen(root.a)).toBe(true)
  })

  it('is idempotent: re-freezing an already-frozen deep graph is a safe no-op', () => {
    const value = deepFreeze({ a: { b: { c: 1 } } })
    expect(() => deepFreeze(value)).not.toThrow()
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.a)).toBe(true)
    expect(Object.isFrozen(value.a.b)).toBe(true)
  })
})
