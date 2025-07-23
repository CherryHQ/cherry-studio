import { describe, expect, it } from 'vitest'

import { LRUCache } from '../lru-cache'

describe('LRUCache', () => {
  it('should set and get values correctly', () => {
    const cache = new LRUCache<string, number>({ max: 3 })

    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(3)
  })

  it('should evict least recently used items when capacity is exceeded', () => {
    const cache = new LRUCache<string, number>({ max: 2 })

    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3) // Should evict 'a'

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('should update LRU order on get', () => {
    const cache = new LRUCache<string, number>({ max: 2 })

    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a') // 'a' should become most recently used
    cache.set('c', 3) // Should evict 'b', not 'a'

    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })

  it('should handle has() method correctly', () => {
    const cache = new LRUCache<string, number>({ max: 2 })

    cache.set('a', 1)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  it('should delete items correctly', () => {
    const cache = new LRUCache<string, number>({ max: 3 })

    cache.set('a', 1)
    cache.set('b', 2)

    expect(cache.delete('a')).toBe(true)
    expect(cache.delete('a')).toBe(false) // Already deleted
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.size).toBe(1)
  })

  it('should clear all items', () => {
    const cache = new LRUCache<string, number>({ max: 3 })

    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    cache.clear()

    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBeUndefined()
  })

  it('should handle dispose callback', () => {
    const disposedItems: Array<{ key: string; value: number }> = []
    const cache = new LRUCache<string, number>({
      max: 2,
      dispose: (value, key) => {
        disposedItems.push({ key, value })
      }
    })

    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3) // Should dispose 'a'

    expect(disposedItems).toEqual([{ key: 'a', value: 1 }])

    cache.delete('b') // Should dispose 'b'

    expect(disposedItems).toEqual([
      { key: 'a', value: 1 },
      { key: 'b', value: 2 }
    ])
  })

  it('should handle TTL expiration', async () => {
    const cache = new LRUCache<string, number>({ max: 3, ttl: 50 })

    cache.set('a', 1)
    cache.set('b', 2)

    expect(cache.get('a')).toBe(1)
    expect(cache.has('a')).toBe(true)

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(cache.get('a')).toBeUndefined()
    expect(cache.has('a')).toBe(false)
  })

  it('should return cache instance from set method for chaining', () => {
    const cache = new LRUCache<string, number>({ max: 3 })

    const result = cache.set('a', 1).set('b', 2).set('c', 3)

    expect(result).toBe(cache)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('should provide correct values and entries', () => {
    const cache = new LRUCache<string, number>({ max: 3 })

    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    const values = cache.values
    const entries = cache.entries

    expect(values).toContain(1)
    expect(values).toContain(2)
    expect(values).toContain(3)
    expect(values.length).toBe(3)

    expect(entries).toContainEqual(['a', 1])
    expect(entries).toContainEqual(['b', 2])
    expect(entries).toContainEqual(['c', 3])
    expect(entries.length).toBe(3)
  })
})
