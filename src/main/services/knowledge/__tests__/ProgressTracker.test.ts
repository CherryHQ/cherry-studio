import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProgressTracker } from '../queue/ProgressTracker'

describe('ProgressTracker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores and retrieves progress', () => {
    const tracker = new ProgressTracker(1_000)

    tracker.set('item-1', 35)

    expect(tracker.get('item-1')).toBe(35)
  })

  it('expires entries after ttl', () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const tracker = new ProgressTracker(100)
    tracker.set('item-1', 80)

    now = 1_050
    expect(tracker.get('item-1')).toBe(80)

    now = 1_101
    expect(tracker.get('item-1')).toBeUndefined()
  })

  it('deletes entries explicitly', () => {
    const tracker = new ProgressTracker(1_000)

    tracker.set('item-1', 20)
    tracker.delete('item-1')

    expect(tracker.get('item-1')).toBeUndefined()
  })
})
