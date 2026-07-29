import { describe, expect, it } from 'vitest'

import { calculateTabInsertIndex, getTabReorderSiblingShift } from '../useTabDrag'

describe('RTL tab drag geometry', () => {
  const tabIds = ['a', 'b', 'c']
  const ltrRects = new Map([
    ['a', { left: 0, width: 100 }],
    ['b', { left: 100, width: 100 }],
    ['c', { left: 200, width: 100 }]
  ])
  const rtlRects = new Map([
    ['a', { left: 200, width: 100 }],
    ['b', { left: 100, width: 100 }],
    ['c', { left: 0, width: 100 }]
  ])

  it('finds insertion points in logical tab order for both directions', () => {
    expect(calculateTabInsertIndex(160, 'a', tabIds, 0, ltrRects, 'ltr')).toBe(2)
    expect(calculateTabInsertIndex(140, 'a', tabIds, 0, rtlRects, 'rtl')).toBe(2)
  })

  it('mirrors the sibling animation while retaining logical reorder indices', () => {
    expect(getTabReorderSiblingShift('ltr', 106, 0, 2, 1)).toBe(-106)
    expect(getTabReorderSiblingShift('rtl', 106, 0, 2, 1)).toBe(106)
    expect(getTabReorderSiblingShift('ltr', 106, 2, 0, 0)).toBe(106)
    expect(getTabReorderSiblingShift('rtl', 106, 2, 0, 0)).toBe(-106)
  })
})
