import { describe, expect, it } from 'vitest'

import { reorderVisibleSubset } from '../reorderVisibleSubset'

const createItem = (id: number) => ({ id: `item-${id}` })

describe('reorderVisibleSubset', () => {
  const items = [createItem(1), createItem(2), createItem(3), createItem(4), createItem(5)]

  it('reorders an unfiltered list', () => {
    const nextItems = reorderVisibleSubset({
      items,
      fromIndex: 0,
      toIndex: 2,
      getId: (item) => item.id
    })

    expect(nextItems.map((item) => item.id)).toEqual(['item-2', 'item-3', 'item-1', 'item-4', 'item-5'])
  })

  it('reorders a filtered visible subset against the full list', () => {
    const visibleItems = [items[0], items[2], items[4]]

    const nextItems = reorderVisibleSubset({
      items,
      visibleItems,
      fromIndex: 2,
      toIndex: 0,
      getId: (item) => item.id
    })

    expect(nextItems.map((item) => item.id)).toEqual(['item-5', 'item-1', 'item-2', 'item-3', 'item-4'])
  })

  it('returns the same list when the indexes are unchanged', () => {
    expect(
      reorderVisibleSubset({
        items,
        fromIndex: 1,
        toIndex: 1,
        getId: (item) => item.id
      })
    ).toBe(items)
  })

  it('returns the same list when either visible index is out of range', () => {
    expect(
      reorderVisibleSubset({
        items,
        visibleItems: [items[1], items[3]],
        fromIndex: 0,
        toIndex: 9,
        getId: (item) => item.id
      })
    ).toBe(items)
  })
})
