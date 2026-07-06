/**
 * Layout constants and pure conversion functions.
 * Includes prefix sums, viewport merge calculations, and other grid layout helpers.
 */

/** Excel default column width: 8.43 chars (Calibri 11, MDW=7), about 64px. */
export const DEFAULT_COL_WIDTH_PX = 64
/** Excel default row height: 15pt = 20px. */
export const DEFAULT_ROW_HEIGHT_PX = 20
/** Hard row/column parse limits. Excess rows/columns are truncated and recorded as warnings. */
export const MAX_ROWS = 200_000
export const MAX_COLS = 500

/** Excel character width -> px (Calibri 11, MDW=7). */
export const charWidthToPx = (width: number): number => Math.round(width * 7) + 5

/** pt -> px. */
export const ptToPx = (pt: number): number => (pt * 96) / 72

/** EMU -> px (914400 EMU/inch / 96 dpi). */
export const emuToPx = (emu: number): number => emu / 9525

/** 1-based column number -> 'A' / 'Z' / 'AA'. */
export const colName = (col: number): string => {
  let name = ''
  let n = col
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/** 1-based (row, col) -> 'B4' style address. */
export const cellAddress = (row: number, col: number): string => `${colName(col)}${row}`

// ---------------------------------------------------------------------------
// Pure layout functions: prefix sums and viewport merge calculations.
// ---------------------------------------------------------------------------

/** Axis layout for rows or columns: zoomed sizes plus start offsets in px. */
export interface AxisLayout {
  /** sizes[i] = zoomed size in px for item i (0-based index, 1-based item number i+1). */
  sizes: number[]
  /** offsets[i] = start offset in px for item i. offsets.length === sizes.length. */
  offsets: number[]
  /** Total size in px. */
  totalSize: number
}

/**
 * Builds one axis layout for row heights or column widths, scaled by zoom.
 * @param count Item count (rowCount / colCount).
 * @param defaultSizePx Default size at zoom=1.
 * @param overrides Sparse override table with 1-based keys. Hidden rows/columns map to 0.
 * @param zoom Scale factor.
 */
export const buildAxisLayout = (
  count: number,
  defaultSizePx: number,
  overrides: Record<number, number>,
  zoom: number
): AxisLayout => {
  const sizes = new Array<number>(count)
  const offsets = new Array<number>(count)
  let offset = 0
  for (let i = 0; i < count; i++) {
    const oneBased = i + 1
    const rawSize = overrides[oneBased] ?? defaultSizePx
    const size = rawSize * zoom
    sizes[i] = size
    offsets[i] = offset
    offset += size
  }
  return { sizes, offsets, totalSize: offset }
}

/** Lookup the start offset in px for item i (0-based). Out-of-range indexes return totalSize. */
export const axisOffset = (layout: AxisLayout, index: number): number => {
  if (index < 0) return 0
  if (index >= layout.offsets.length) return layout.totalSize
  return layout.offsets[index]
}

export interface ViewportRect {
  top: number
  left: number
  bottom: number
  right: number
}

export interface MergeRangeLike {
  top: number
  left: number
  bottom: number
  right: number
}

export interface MergeInView<M extends MergeRangeLike = MergeRangeLike> {
  merge: M
  /** Master cell address, the top-left corner of the merged range. */
  masterRow: number
  masterCol: number
  /** Pixel rect relative to the grid origin, with zoom already applied. */
  rect: PxRectLike
}

export interface PxRectLike {
  x: number
  y: number
  width: number
  height: number
}

/** Merged range (1-based inclusive) -> pixel rect, based on row/column AxisLayout. */
export const mergeRectPx = (merge: MergeRangeLike, rowLayout: AxisLayout, colLayout: AxisLayout): PxRectLike => {
  const x = axisOffset(colLayout, merge.left - 1)
  const y = axisOffset(rowLayout, merge.top - 1)
  const right = axisOffset(colLayout, merge.right)
  const bottom = axisOffset(rowLayout, merge.bottom)
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * Merged ranges intersecting the viewport, including master coordinates and pixel rects.
 * A range is returned even when its master cell has scrolled out, as long as the merged rect intersects the viewport.
 * This is why the merge layer must render independently instead of relying on cell virtualization.
 */
export const mergesInView = <M extends MergeRangeLike>(
  merges: M[],
  viewport: ViewportRect,
  rowLayout: AxisLayout,
  colLayout: AxisLayout
): MergeInView<M>[] => {
  const result: MergeInView<M>[] = []
  for (const merge of merges) {
    const rect = mergeRectPx(merge, rowLayout, colLayout)
    const intersects =
      rect.x < viewport.right &&
      rect.x + rect.width > viewport.left &&
      rect.y < viewport.bottom &&
      rect.y + rect.height > viewport.top
    if (!intersects) continue
    result.push({ merge, masterRow: merge.top, masterCol: merge.left, rect })
  }
  return result
}

/** Whether a cell is covered by a merged range but is not the master. Used to empty the regular cell layer. */
export const findCoveringMerge = <M extends MergeRangeLike>(merges: M[], row: number, col: number): M | undefined =>
  merges.find((m) => row >= m.top && row <= m.bottom && col >= m.left && col <= m.right)

/** Excel default font size 11pt -> px at zoom=1. Matches the CellStyle.fontSizePx default. */
export const DEFAULT_FONT_SIZE_PX = ptToPx(11)

/** Line-height multiplier for wrapped cell text. */
export const WRAP_LINE_HEIGHT = 1.3

/**
 * Number of full text lines a wrapped cell can fit in the given cell height, minimum 1.
 * Used with -webkit-line-clamp so a short row shows only complete lines instead of slicing the last line in half.
 */
export const wrapClampLines = (cellHeightPx: number, fontSizePx: number): number =>
  Math.max(1, Math.floor(cellHeightPx / (fontSizePx * WRAP_LINE_HEIGHT)))
