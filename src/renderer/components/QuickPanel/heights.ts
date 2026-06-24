/** Height of one list item in pixels. */
export const QUICK_PANEL_ITEM_HEIGHT = 31

/** Safe gap between the panel top and frame top in pixels. */
export const QUICK_PANEL_SAFE_MARGIN = 8

/** Body vertical padding plus border, combined with measured footer height for chrome height. */
export const QUICK_PANEL_BODY_CHROME_VERTICAL_SPACE = 12

/** Default non-list panel chrome height: footer, header, and padding. */
const READONLY_CHROME_HEIGHT = 50
const DEFAULT_CHROME_HEIGHT = 98

export interface QuickPanelHeightOptions {
  isVisible: boolean
  collapsed: boolean
  readOnly: boolean
  pageSize: number
  itemCount: number
  /** Available height cap above the input; only used for fill/home placement. */
  availableHeight: number | null
  /** Home placement is capped by available height; other placements keep the fixed height. */
  fill?: boolean
  /** Runtime-measured footer plus body chrome height for home/fill; docked/readOnly use defaults. */
  chromeHeight?: number
}

export interface QuickPanelHeights {
  /** Outer panel maxHeight; also used as explicit body height when home content overflows. */
  panelMaxHeight: number
  /** Virtual list scroller size: fits content, or shrinks for internal scrolling when fill space is tight. */
  listHeight: number
}

/**
 * Calculates QuickPanel panel and list heights.
 *
 * - fill/home: use content height while it fits; cap to available frame height and scroll the list when it overflows.
 * - default/docked: keep the original fixed height and ignore availableHeight.
 */
export function getQuickPanelHeights({
  isVisible,
  collapsed,
  readOnly,
  pageSize,
  itemCount,
  availableHeight,
  fill = false,
  chromeHeight: measuredChromeHeight
}: QuickPanelHeightOptions): QuickPanelHeights {
  const defaultChromeHeight = readOnly ? READONLY_CHROME_HEIGHT : DEFAULT_CHROME_HEIGHT
  const chromeHeight = fill && !readOnly && measuredChromeHeight != null ? measuredChromeHeight : defaultChromeHeight

  if (!isVisible) return { panelMaxHeight: 0, listHeight: 0 }
  if (collapsed) return { panelMaxHeight: defaultChromeHeight, listHeight: 0 }

  const listContentHeight = Math.min(pageSize, itemCount) * QUICK_PANEL_ITEM_HEIGHT
  const contentHeight = chromeHeight + listContentHeight

  if (fill && availableHeight != null) {
    const minimumPanelHeight = chromeHeight + QUICK_PANEL_ITEM_HEIGHT
    const panelMaxHeight = Math.max(minimumPanelHeight, Math.min(contentHeight, availableHeight))
    const listHeight = Math.min(listContentHeight, Math.max(0, panelMaxHeight - chromeHeight))
    return { panelMaxHeight, listHeight }
  }

  return { panelMaxHeight: pageSize * QUICK_PANEL_ITEM_HEIGHT + chromeHeight, listHeight: listContentHeight }
}
