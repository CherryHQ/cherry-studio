import { describe, expect, it } from 'vitest'

import { getQuickPanelHeights, QUICK_PANEL_ITEM_HEIGHT } from '../heights'

const ITEM = QUICK_PANEL_ITEM_HEIGHT
const DEFAULT_CHROME = 98
const READONLY_CHROME = 50

const base = {
  isVisible: true,
  collapsed: false,
  readOnly: false,
  pageSize: 7,
  itemCount: 10,
  availableHeight: null as number | null,
  fill: false
}

describe('getQuickPanelHeights', () => {
  describe('default (docked / non-fill): fixed height, ignores availableHeight', () => {
    it('uses the fixed ideal height when availableHeight is null', () => {
      const { panelMaxHeight, listHeight } = getQuickPanelHeights(base)
      expect(panelMaxHeight).toBe(base.pageSize * ITEM + DEFAULT_CHROME)
      expect(listHeight).toBe(Math.min(base.pageSize, base.itemCount) * ITEM)
    })

    it('still uses the fixed height even when availableHeight is small (docked has no top clipping)', () => {
      const { panelMaxHeight, listHeight } = getQuickPanelHeights({ ...base, availableHeight: 120 })
      expect(panelMaxHeight).toBe(base.pageSize * ITEM + DEFAULT_CHROME)
      expect(listHeight).toBe(base.pageSize * ITEM)
    })

    it('caps the list height to the actual item count', () => {
      expect(getQuickPanelHeights({ ...base, itemCount: 2 }).listHeight).toBe(2 * ITEM)
    })

    it('uses the read-only chrome height', () => {
      expect(getQuickPanelHeights({ ...base, readOnly: true }).panelMaxHeight).toBe(
        base.pageSize * ITEM + READONLY_CHROME
      )
    })
  })

  describe('fill (welcome / placement=home): panel prefers content height until it exceeds the available space', () => {
    it('uses content height instead of filling the available space for few items', () => {
      const available = 400
      const { panelMaxHeight, listHeight } = getQuickPanelHeights({
        ...base,
        fill: true,
        itemCount: 2,
        availableHeight: available
      })
      expect(panelMaxHeight).toBe(DEFAULT_CHROME + 2 * ITEM)
      expect(panelMaxHeight).not.toBe(available)
      expect(listHeight).toBe(2 * ITEM)
    })

    it('uses content height when pageSize-capped content still fits', () => {
      const available = 400
      const { panelMaxHeight, listHeight } = getQuickPanelHeights({
        ...base,
        fill: true,
        itemCount: 50,
        availableHeight: available
      })
      expect(panelMaxHeight).toBe(DEFAULT_CHROME + base.pageSize * ITEM)
      expect(panelMaxHeight).not.toBe(available)
      expect(listHeight).toBe(base.pageSize * ITEM)
    })

    it('caps the panel at the available height and shrinks the list when content overflows', () => {
      const available = DEFAULT_CHROME + 3 * ITEM
      const { panelMaxHeight, listHeight } = getQuickPanelHeights({
        ...base,
        fill: true,
        itemCount: 50,
        availableHeight: available
      })
      expect(panelMaxHeight).toBe(available)
      expect(listHeight).toBe(3 * ITEM)
    })

    it('uses measured chrome height when capping a home panel', () => {
      const measuredChrome = 42
      const available = measuredChrome + 3 * ITEM
      const { panelMaxHeight, listHeight } = getQuickPanelHeights({
        ...base,
        fill: true,
        itemCount: 50,
        availableHeight: available,
        chromeHeight: measuredChrome
      })
      expect(panelMaxHeight).toBe(available)
      expect(listHeight).toBe(3 * ITEM)
    })

    it('never shrinks the panel below one row of chrome when the available space is tiny', () => {
      expect(getQuickPanelHeights({ ...base, fill: true, itemCount: 1, availableHeight: 10 }).panelMaxHeight).toBe(
        DEFAULT_CHROME + ITEM
      )
    })

    it('stays compact (chrome only) when collapsed even in fill mode', () => {
      const { panelMaxHeight, listHeight } = getQuickPanelHeights({
        ...base,
        fill: true,
        collapsed: true,
        availableHeight: 400
      })
      expect(panelMaxHeight).toBe(DEFAULT_CHROME)
      expect(listHeight).toBe(0)
    })
  })

  it('returns zeros when the panel is hidden', () => {
    expect(getQuickPanelHeights({ ...base, isVisible: false })).toEqual({ panelMaxHeight: 0, listHeight: 0 })
  })
})
