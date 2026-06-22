import { describe, expect, it } from 'vitest'

import { firstQuickPanelSelectableIndex, moveQuickPanelSelectableIndex } from '../QuickPanelList'

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

  it('moves by page without wrapping', () => {
    const items = createItems()

    expect(moveQuickPanelSelectableIndex(items, 0, 2, { wrap: false })).toBe(3)
    expect(moveQuickPanelSelectableIndex(items, 3, 2, { wrap: false })).toBe(4)
    expect(moveQuickPanelSelectableIndex(items, 3, -2, { wrap: false })).toBe(0)
  })
})
