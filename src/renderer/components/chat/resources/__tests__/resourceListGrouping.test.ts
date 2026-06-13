import { describe, expect, it } from 'vitest'

import {
  composeResourceListGroupResolvers,
  createPinnedFirstSorter,
  createPinnedGroupResolver,
  createTimeGroupResolver,
  getResourceTimeBucket,
  sortByResourceGroupRank
} from '../resourceListGrouping'

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
})
