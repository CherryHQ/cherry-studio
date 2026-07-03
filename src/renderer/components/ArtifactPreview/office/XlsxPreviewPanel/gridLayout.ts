/**
 * 布局常量与换算纯函数(契约 §6,冻结)。
 * 布局函数(前缀和、可视区合并计算)由 WP-D 在本文件追加:.context/xlsx-preview/05-wp-grid.md
 */

/** Excel 默认列宽 8.43 字符(Calibri 11,MDW=7)≈ 64px */
export const DEFAULT_COL_WIDTH_PX = 64
/** Excel 默认行高 15pt = 20px */
export const DEFAULT_ROW_HEIGHT_PX = 20
/** 解析行/列硬上限,超出截断并记 warning */
export const MAX_ROWS = 200_000
export const MAX_COLS = 500

/** Excel 字符宽 → px(Calibri 11,MDW=7) */
export const charWidthToPx = (width: number): number => Math.round(width * 7) + 5

/** pt → px */
export const ptToPx = (pt: number): number => (pt * 96) / 72

/** EMU → px(914400 EMU/inch ÷ 96 dpi) */
export const emuToPx = (emu: number): number => emu / 9525

/** 列号(1-based)→ 'A' / 'Z' / 'AA' */
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

/** (row, col) 1-based → 'B4' 风格地址 */
export const cellAddress = (row: number, col: number): string => `${colName(col)}${row}`

// ---------------------------------------------------------------------------
// WP-D 布局纯函数(追加区):前缀和、可视区合并计算。见 05-wp-grid.md。
// ---------------------------------------------------------------------------

/** 一个轴(行或列)的布局:每项 zoom 后尺寸(px)+ 起始偏移(px)的前缀和表 */
export interface AxisLayout {
  /** sizes[i] = 第 i 项(0-based index,对应 1-based 序号 i+1)zoom 后尺寸,px */
  sizes: number[]
  /** offsets[i] = 第 i 项的起始偏移(px);offsets.length === sizes.length */
  offsets: number[]
  /** 总尺寸,px */
  totalSize: number
}

/**
 * 构建一个轴的布局(行高或列宽),已按 zoom 缩放。
 * @param count 项数(rowCount / colCount)
 * @param defaultSizePx 默认尺寸(zoom=1)
 * @param overrides 稀疏覆盖表,1-based key(隐藏 → 0)
 * @param zoom 缩放系数
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

/** 查表:第 i 项(0-based)的起始偏移,px(越界返回 totalSize) */
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
  /** master 单元格地址(合并区左上角) */
  masterRow: number
  masterCol: number
  /** 像素矩形(相对网格原点,已含 zoom) */
  rect: PxRectLike
}

export interface PxRectLike {
  x: number
  y: number
  width: number
  height: number
}

/** 合并区(1-based 闭区间)→ 像素矩形,基于行/列 AxisLayout */
export const mergeRectPx = (merge: MergeRangeLike, rowLayout: AxisLayout, colLayout: AxisLayout): PxRectLike => {
  const x = axisOffset(colLayout, merge.left - 1)
  const y = axisOffset(rowLayout, merge.top - 1)
  const right = axisOffset(colLayout, merge.right)
  const bottom = axisOffset(rowLayout, merge.bottom)
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * 与可视矩形相交的合并区(含 master 坐标与像素矩形)。
 * 即使 master 单元格本身滚出视口,只要合并区与视口相交仍会返回——
 * 这是合并层必须独立渲染而非依赖单元格虚拟化的原因。
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

/** 单元格是否被某个合并区覆盖但不是 master(用于普通单元格层置空内容) */
export const findCoveringMerge = <M extends MergeRangeLike>(merges: M[], row: number, col: number): M | undefined =>
  merges.find((m) => row >= m.top && row <= m.bottom && col >= m.left && col <= m.right)

/** Excel 默认字号 11pt → px(zoom=1),与 CellStyle.fontSizePx 未设置时的默认一致 */
export const DEFAULT_FONT_SIZE_PX = ptToPx(11)

/** 字号(px,zoom=1)按 zoom 缩放 */
export const scaledFontSizePx = (fontSizePx: number | undefined, zoom: number): number =>
  (fontSizePx ?? DEFAULT_FONT_SIZE_PX) * zoom
