import {
  compareResourceCreationOrder,
  compareResourceOrderKey,
  composeResourceListGroupResolvers,
  createPinnedFirstSorter,
  createPinnedGroupResolver,
  sortByResourceGroupRank,
  sortRankedResourceItems
} from '@renderer/utils/chat/resourceListBase'
import { describe, expect, it } from 'vitest'

type TestItem = {
  id: string
  pinned?: boolean
  createdAt: string
}

function localIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString()
}

describe('resource list grouping', () => {
  it('composes pinned and fallback resolvers with the first matching group winning', () => {
    const resolver = composeResourceListGroupResolvers<TestItem>(
      createPinnedGroupResolver({
        isPinned: (item) => item.pinned === true,
        group: { id: 'pinned', label: 'Pinned' }
      }),
      () => ({ id: 'created', label: '' })
    )

    expect(resolver({ id: 'pinned', pinned: true, createdAt: localIso(2026, 5, 15, 9) })).toEqual({
      id: 'pinned',
      label: 'Pinned'
    })
    expect(resolver({ id: 'regular', createdAt: localIso(2026, 5, 14, 9) })).toEqual({ id: 'created', label: '' })
  })

  it('sorts pinned items into a stable top layer before derived groups are rendered', () => {
    const items: TestItem[] = [
      { id: 'new', createdAt: localIso(2026, 5, 12, 9) },
      { id: 'pinned-old', pinned: true, createdAt: localIso(2026, 5, 4, 23) },
      { id: 'old', createdAt: localIso(2026, 5, 6, 9) },
      { id: 'pinned-new', pinned: true, createdAt: localIso(2026, 5, 12, 9) }
    ]

    expect(
      sortByResourceGroupRank(items, createPinnedFirstSorter({ isPinned: (item) => item.pinned === true })).map(
        (item) => item.id
      )
    ).toEqual(['pinned-old', 'pinned-new', 'new', 'old'])
  })

  describe('sortRankedResourceItems', () => {
    it('keeps pinned in incoming order at the top, then orders the rest by the within-group key', () => {
      // Callers fold pinned → rank 0. p-b has a newer creation time than p-a but must
      // stay after it (pinned rows keep their incoming server business order,
      // never reshuffled); non-pinned then sort newest-first.
      const items: TestItem[] = [
        { id: 'p-a', pinned: true, createdAt: localIso(2026, 5, 1) },
        { id: 'n-old', createdAt: localIso(2026, 5, 2) },
        { id: 'p-b', pinned: true, createdAt: localIso(2026, 5, 20) },
        { id: 'n-new', createdAt: localIso(2026, 5, 10) }
      ]

      const sorted = sortRankedResourceItems(items, {
        getRank: (item) => (item.pinned === true ? 0 : 1),
        isPinned: (item) => item.pinned === true,
        compareWithinGroup: compareResourceCreationOrder
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
})
