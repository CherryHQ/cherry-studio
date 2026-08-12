import { describe, expect, it } from 'vitest'

import { sortResourceItemsByPinnedTime } from '../resourceEntitySort'

type TestItem = {
  id: string
  pinned?: boolean
  lastActivityAt: string
}

function localIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString()
}

describe('sortResourceItemsByPinnedTime', () => {
  it('keeps pinned items stable before time-sorted unpinned items', () => {
    const now = new Date(2026, 4, 15, 12)
    const items: TestItem[] = [
      { id: 'yesterday', lastActivityAt: localIso(2026, 5, 14, 9) },
      { id: 'pinned-old', pinned: true, lastActivityAt: localIso(2026, 5, 1, 9) },
      { id: 'today-older', lastActivityAt: localIso(2026, 5, 15, 8) },
      { id: 'pinned-new', pinned: true, lastActivityAt: localIso(2026, 5, 15, 11) },
      { id: 'this-week', lastActivityAt: localIso(2026, 5, 13, 9) },
      { id: 'today-newer', lastActivityAt: localIso(2026, 5, 15, 10) },
      { id: 'earlier', lastActivityAt: localIso(2026, 5, 1, 9) }
    ]

    expect(sortResourceItemsByPinnedTime(items, now).map((item) => item.id)).toEqual([
      'pinned-old',
      'pinned-new',
      'today-newer',
      'today-older',
      'yesterday',
      'this-week',
      'earlier'
    ])
  })

  it('keeps invalid timestamps in the earlier bucket without disturbing stable order', () => {
    const now = new Date(2026, 4, 15, 12)
    const items: TestItem[] = [
      { id: 'invalid', lastActivityAt: 'not-a-date' },
      { id: 'empty', lastActivityAt: '' },
      { id: 'yesterday', lastActivityAt: localIso(2026, 5, 14, 9) }
    ]

    expect(sortResourceItemsByPinnedTime(items, now).map((item) => item.id)).toEqual(['yesterday', 'invalid', 'empty'])
  })

  it('keeps empty arrays and equal timestamps stable', () => {
    const now = new Date(2026, 4, 15, 12)
    const sameTimestamp = localIso(2026, 5, 15, 9)
    const items: TestItem[] = [
      { id: 'first', lastActivityAt: sameTimestamp },
      { id: 'second', lastActivityAt: sameTimestamp }
    ]

    expect(sortResourceItemsByPinnedTime([], now)).toEqual([])
    expect(sortResourceItemsByPinnedTime(items, now).map((item) => item.id)).toEqual(['first', 'second'])
  })
})
