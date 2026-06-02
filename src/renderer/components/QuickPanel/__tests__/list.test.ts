import { describe, expect, it } from 'vitest'

import {
  firstQuickPanelSelectableIndex,
  moveQuickPanelSelectableIndex,
  type QuickPanelCandidateItem,
  toggleQuickPanelSelectedId
} from '../list'

const createItems = (): QuickPanelCandidateItem[] => [
  { id: 'one', label: 'One' },
  { id: 'disabled', label: 'Disabled', disabled: true },
  { id: 'two', label: 'Two' },
  { id: 'three', label: 'Three' },
  { id: 'four', label: 'Four' }
]

describe('QuickPanel list primitives', () => {
  it('finds the first selectable item', () => {
    expect(
      firstQuickPanelSelectableIndex([{ id: 'disabled', label: 'Disabled', disabled: true }, ...createItems()])
    ).toBe(1)
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

  it('toggles selected ids immutably', () => {
    const selectedIds = new Set(['one'])
    const withoutOne = toggleQuickPanelSelectedId(selectedIds, 'one')
    const withTwo = toggleQuickPanelSelectedId(withoutOne, 'two')

    expect([...selectedIds]).toEqual(['one'])
    expect(withoutOne.has('one')).toBe(false)
    expect(withTwo.has('two')).toBe(true)
  })
})
