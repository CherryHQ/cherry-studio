import { describe, expect, it } from 'vitest'

import { mergeFollowupQueues } from '../followupQueueMerge'

const entry = (ids: string[], extra: Record<string, unknown> = {}) => ({
  items: ids.map((id) => ({ id })),
  paused: false,
  ...extra
})

describe('mergeFollowupQueues', () => {
  it('keeps unrelated conversations from both snapshots', () => {
    const merged = mergeFollowupQueues({ a: entry(['x']) }, { b: entry(['y']) })
    expect(Object.keys(merged).sort()).toEqual(['a', 'b'])
  })

  it('propagates a null tombstone as a deletion', () => {
    const merged = mergeFollowupQueues({ a: entry(['x']) }, { a: null })
    expect('a' in merged).toBe(false)
  })

  it('unions concurrent enqueues to the same conversation', () => {
    const merged = mergeFollowupQueues({ a: entry(['x']) }, { a: entry(['x', 'y']) }) as any
    expect(merged.a.items.map((item: any) => item.id).sort()).toEqual(['x', 'y'])
  })

  it('unions a same-scope removal instead of dropping (stale snapshots are indistinguishable)', () => {
    // Without versions a snapshot missing y may predate y's enqueue, so the merge
    // keeps y rather than risk losing a queued message. Only an empty incoming
    // entry (clear-all) propagates as an authoritative deletion.
    const merged = mergeFollowupQueues({ a: entry(['x', 'y']) }, { a: entry(['x']) }) as any
    expect(merged.a.items.map((item: any) => item.id).sort()).toEqual(['x', 'y'])
  })

  it('merges pause intent with OR so a remote write cannot unpause a failed queue', () => {
    const merged = mergeFollowupQueues(
      { a: entry(['x'], { paused: true }) },
      { a: entry(['x'], { paused: false }) }
    ) as any
    expect(merged.a.paused).toBe(true)
  })

  it('keeps failedItemId only while a surviving item still carries it', () => {
    const failed = mergeFollowupQueues({ a: entry(['x'], { failedItemId: 'x' }) }, { a: entry(['x']) }) as any
    expect(failed.a.failedItemId).toBe('x')

    const cleared = mergeFollowupQueues({ a: entry(['x'], { failedItemId: 'x' }) }, { a: entry([]) }) as any
    expect(cleared.a.failedItemId).toBeUndefined()
  })

  it('accepts a fresh non-empty queue over a local tombstone', () => {
    const merged = mergeFollowupQueues({ a: null }, { a: entry(['y']) })
    expect(merged.a).toEqual(entry(['y']))
  })
})
