import { describe, expect, it } from 'vitest'

import {
  compareResourceRecency,
  composeResourceListGroupResolvers,
  createPinnedFirstSorter,
  createPinnedGroupResolver,
  createTimeGroupResolver,
  getResourceTimeBucket,
  sortByResourceGroupRank,
  sortRankedResourceItems
} from '../resourceListGrouping'
import { compareResourceOrderKey } from '../resourceListReorder'

type TestItem = {
  id: string
  pinned?: boolean
  updatedAt: string
}

function localIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString()
}

describe('resourceListGrouping', () => {
  it('classifies timestamps into today, yesterday, this-week, and earlier buckets', () => {
    const now = new Date(2026, 4, 15, 12)

    expect(getResourceTimeBucket(localIso(2026, 5, 15, 9), now)).toBe('today')
    expect(getResourceTimeBucket(localIso(2026, 5, 14, 9), now)).toBe('yesterday')
    expect(getResourceTimeBucket(localIso(2026, 5, 13, 9), now)).toBe('this-week')
    expect(getResourceTimeBucket(localIso(2026, 5, 8, 23), now)).toBe('earlier')
  })

  it('composes pinned and time resolvers with the first matching group winning', () => {
    const now = new Date(2026, 4, 15, 12)
    const resolver = composeResourceListGroupResolvers<TestItem>(
      createPinnedGroupResolver({
        isPinned: (item) => item.pinned === true,
        group: { id: 'pinned', label: 'Pinned' }
      }),
      createTimeGroupResolver({
        getTimestamp: (item) => item.updatedAt,
        labels: {
          today: 'Today',
          yesterday: 'Yesterday',
          'this-week': 'This week',
          earlier: 'Earlier'
        },
        now
      })
    )

    expect(resolver({ id: 'pinned-today', pinned: true, updatedAt: localIso(2026, 5, 15, 9) })).toEqual({
      id: 'pinned',
      label: 'Pinned'
    })
    expect(resolver({ id: 'today', updatedAt: localIso(2026, 5, 15, 9) })).toEqual({
      id: 'time:today',
      label: 'Today'
    })
    expect(resolver({ id: 'yesterday', updatedAt: localIso(2026, 5, 14, 9) })).toEqual({
      id: 'time:yesterday',
      label: 'Yesterday'
    })
    expect(resolver({ id: 'week', updatedAt: localIso(2026, 5, 13, 9) })).toEqual({
      id: 'time:this-week',
      label: 'This week'
    })
    expect(resolver({ id: 'earlier', updatedAt: localIso(2026, 5, 8, 23) })).toEqual({
      id: 'time:earlier',
      label: 'Earlier'
    })
  })

  it('sorts pinned items into a stable top layer before derived groups are rendered', () => {
    const items: TestItem[] = [
      { id: 'today', updatedAt: localIso(2026, 5, 12, 9) },
      { id: 'pinned-old', pinned: true, updatedAt: localIso(2026, 5, 4, 23) },
      { id: 'week', updatedAt: localIso(2026, 5, 6, 9) },
      { id: 'pinned-new', pinned: true, updatedAt: localIso(2026, 5, 12, 9) }
    ]

    expect(
      sortByResourceGroupRank(items, createPinnedFirstSorter({ isPinned: (item) => item.pinned === true })).map(
        (item) => item.id
      )
    ).toEqual(['pinned-old', 'pinned-new', 'today', 'week'])
  })

  describe('sortRankedResourceItems', () => {
    it('keeps pinned in incoming order at the top, then orders the rest by the within-group key', () => {
      // Callers fold pinned → rank 0. p-b has a newer timestamp than p-a but must
      // stay after it (pinned rows keep their incoming/server pin.orderKey order,
      // never reshuffled by recency); non-pinned then sort newest-first.
      const items: TestItem[] = [
        { id: 'p-a', pinned: true, updatedAt: localIso(2026, 5, 1) },
        { id: 'n-old', updatedAt: localIso(2026, 5, 2) },
        { id: 'p-b', pinned: true, updatedAt: localIso(2026, 5, 20) },
        { id: 'n-new', updatedAt: localIso(2026, 5, 10) }
      ]

      const sorted = sortRankedResourceItems(items, {
        getRank: (item) => (item.pinned === true ? 0 : 1),
        isPinned: (item) => item.pinned === true,
        compareWithinGroup: compareResourceRecency((item) => item.updatedAt)
      })

      expect(sorted.map((item) => item.id)).toEqual(['p-a', 'p-b', 'n-new', 'n-old'])
    })

    it('separates groups by rank and falls back to a stable index tiebreak', () => {
      type OrderItem = { id: string; rank: number; orderKey: string }
      const items: OrderItem[] = [
        { id: 'g1-b', rank: 1, orderKey: 'a2' },
        { id: 'g0-x', rank: 0, orderKey: 'a9' },
        { id: 'g1-a', rank: 1, orderKey: 'a1' },
        { id: 'tie-1', rank: 1, orderKey: 'a5' },
        { id: 'tie-2', rank: 1, orderKey: 'a5' }
      ]

      const sorted = sortRankedResourceItems(items, {
        getRank: (item) => item.rank,
        isPinned: () => false,
        compareWithinGroup: (a, b) => compareResourceOrderKey(a.orderKey, b.orderKey)
      })

      // rank 0 first; rank 1 by orderKey ASC; equal orderKey preserves incoming index.
      expect(sorted.map((item) => item.id)).toEqual(['g0-x', 'g1-a', 'g1-b', 'tie-1', 'tie-2'])
    })
  })

  it('compareResourceRecency ranks newer first and treats unparseable timestamps as equal', () => {
    const compare = compareResourceRecency<{ updatedAt: string }>((item) => item.updatedAt)
    const newer = { updatedAt: localIso(2026, 5, 10) }
    const older = { updatedAt: localIso(2026, 5, 1) }

    expect(compare(newer, older)).toBeLessThan(0)
    expect(compare(older, newer)).toBeGreaterThan(0)
    expect(compare({ updatedAt: 'nonsense' }, older)).toBe(0)
    expect(compare({ updatedAt: 'nonsense' }, { updatedAt: 'also bad' })).toBe(0)
  })
})
