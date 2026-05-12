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
  it('classifies timestamps into today, within-week, and earlier buckets', () => {
    const now = new Date(2026, 4, 12, 12)

    expect(getResourceTimeBucket(localIso(2026, 5, 12, 9), now)).toBe('today')
    expect(getResourceTimeBucket(localIso(2026, 5, 6, 9), now)).toBe('within-week')
    expect(getResourceTimeBucket(localIso(2026, 5, 4, 23), now)).toBe('earlier')
  })

  it('composes pinned and time resolvers with the first matching group winning', () => {
    const now = new Date(2026, 4, 12, 12)
    const resolver = composeResourceListGroupResolvers<TestItem>(
      createPinnedGroupResolver({
        isPinned: (item) => item.pinned === true,
        group: { id: 'pinned', label: 'Pinned' }
      }),
      createTimeGroupResolver({
        getTimestamp: (item) => item.updatedAt,
        labels: {
          today: 'Today',
          'within-week': 'Within a week',
          earlier: 'Earlier'
        },
        now
      })
    )

    expect(resolver({ id: 'pinned-today', pinned: true, updatedAt: localIso(2026, 5, 12, 9) })).toEqual({
      id: 'pinned',
      label: 'Pinned'
    })
    expect(resolver({ id: 'today', updatedAt: localIso(2026, 5, 12, 9) })).toEqual({
      id: 'time:today',
      label: 'Today'
    })
    expect(resolver({ id: 'week', updatedAt: localIso(2026, 5, 6, 9) })).toEqual({
      id: 'time:within-week',
      label: 'Within a week'
    })
    expect(resolver({ id: 'earlier', updatedAt: localIso(2026, 5, 4, 23) })).toEqual({
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
