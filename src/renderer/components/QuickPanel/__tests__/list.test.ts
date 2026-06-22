import { describe, expect, it } from 'vitest'

import { firstQuickPanelSelectableIndex, moveQuickPanelSelectableIndex } from '../list'

const createItems = (): { id: string; disabled?: boolean }[] => [
  { id: 'one' },
  { id: 'disabled', disabled: true },
  { id: 'two' },
  { id: 'three' },
  { id: 'four' }
]

describe('QuickPanel list primitives', () => {
  it('finds the first selectable item', () => {
    expect(firstQuickPanelSelectableIndex([{ id: 'disabled', disabled: true }, ...createItems()])).toBe(1)
  })

  it('moves by one with wrapping while skipping disabled items', () => {
    const items = createItems()

    expect(moveQuickPanelSelectableIndex(items, 0, 1, { wrap: true })).toBe(2)
    expect(moveQuickPanelSelectableIndex(items, 0, -1, { wrap: true })).toBe(4)
  })

  it('wraps a page-jump larger than the selectable count to a valid index (not undefined)', () => {
    const items = createItems() // 4 selectable: [0, 2, 3, 4]

    // |offset| > selectable count — e.g. Cmd/Ctrl+ArrowUp page-jump (pageSize 7) with 4 rows.
    expect(moveQuickPanelSelectableIndex(items, 0, -7, { wrap: true })).toBe(2)
    expect(moveQuickPanelSelectableIndex(items, 0, 7, { wrap: true })).toBe(4)
    for (const start of [0, 2, 3, 4]) {
      expect(moveQuickPanelSelectableIndex(items, start, -7, { wrap: true })).not.toBeUndefined()
    }
  })

  it('moves by page without wrapping', () => {
    const items = createItems()

    expect(moveQuickPanelSelectableIndex(items, 0, 2, { wrap: false })).toBe(3)
    expect(moveQuickPanelSelectableIndex(items, 3, 2, { wrap: false })).toBe(4)
    expect(moveQuickPanelSelectableIndex(items, 3, -2, { wrap: false })).toBe(0)
  })
})
