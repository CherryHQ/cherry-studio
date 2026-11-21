/** Grid placement and style resolution for PPTD table elements. */

import type { PptdBorder, PptdBorderSpec, PptdCell, PptdCellStyle, PptdTableStyleConfig } from './pptdFormat'
import type { ResolvedPptdTextStyle } from './pptdRichText'
import { resolvePptdTextStyle } from './pptdRichText'
import type { PptdStyleContext } from './pptdStyle'

export interface PptdTableCellPlacement {
  cell: PptdCell
  row: number
  col: number
  rowSpan: number
  colSpan: number
}

/**
 * Places cells onto the grid per the reference: merged regions declare their
 * span and the covered positions are omitted from the rows array, so each
 * cell takes the next free column in its row.
 */
export function placePptdTableCells(rows: readonly (readonly PptdCell[])[]): PptdTableCellPlacement[] {
  const placements: PptdTableCellPlacement[] = []
  const occupied = new Set<string>()
  rows.forEach((row, r) => {
    let col = 0
    for (const cell of row) {
      while (occupied.has(`${r}:${col}`)) col++
      const rowSpan = cell.rowSpan ?? 1
      const colSpan = cell.colSpan ?? 1
      placements.push({ cell, row: r, col, rowSpan, colSpan })
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          occupied.add(`${r + dr}:${col + dc}`)
        }
      }
      col += colSpan
    }
  })
  return placements
}

/** Resolves the table style: a "$key" theme reference or an inline config. */
export function resolvePptdTableStyleConfig(
  style: string | PptdTableStyleConfig | undefined,
  context: PptdStyleContext
): PptdTableStyleConfig | undefined {
  if (!style) return undefined
  if (typeof style === 'string') {
    return style.startsWith('$') ? context.theme?.tableStyles?.[style.slice(1)] : undefined
  }
  return style
}

const TEXT_FIELDS = [
  'color',
  'fontSize',
  'fontFamily',
  'bold',
  'italic',
  'backgroundColor',
  'lineHeight',
  'lineHeightPx',
  'letterSpacing',
  'marginTop'
] as const

function mergeTextFields(target: Partial<ResolvedPptdTextStyle>, source: PptdCellStyle | PptdCell | undefined): void {
  if (!source) return
  for (const field of TEXT_FIELDS) {
    const value = source[field]
    if (value !== undefined) (target as Record<string, unknown>)[field] = value
  }
}

/**
 * The cell's position-category style chain, lowest to highest: cellStyle <
 * bodyStyles (cycled by data-row index) < first/last column < first/last
 * row, with rowOverColumn deciding the row/column winner.
 */
export function resolvePptdCellCategoryStyle(
  config: PptdTableStyleConfig | undefined,
  row: number,
  col: number,
  rowCount: number,
  colCount: number
): PptdCellStyle {
  const merged: PptdCellStyle = {}
  if (!config) return merged
  const apply = (style: PptdCellStyle | undefined) => {
    if (style) Object.assign(merged, Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)))
  }
  apply(config.cellStyle)
  if (config.bodyStyles && config.bodyStyles.length > 0 && row > 0 && row < rowCount - 1) {
    apply(config.bodyStyles[(row - 1) % config.bodyStyles.length])
  }
  const columnStyle = col === 0 ? config.firstColumnStyle : col === colCount - 1 ? config.lastColumnStyle : undefined
  const rowStyle = row === 0 ? config.firstRowStyle : row === rowCount - 1 ? config.lastRowStyle : undefined
  if (config.rowOverColumn === false) {
    apply(rowStyle)
    apply(columnStyle)
  } else {
    apply(columnStyle)
    apply(rowStyle)
  }
  return merged
}

/**
 * Full text style for a cell: defaults < position-category chain < the
 * textStyle theme reference < the cell's inline fields. Rich text markup in
 * the cell text still wins inside the renderer.
 */
export function resolvePptdCellTextStyle(
  cell: PptdCell,
  categoryStyle: PptdCellStyle,
  context: PptdStyleContext
): ResolvedPptdTextStyle {
  const base = resolvePptdTextStyle({ text: '' }, context)
  mergeTextFields(base, categoryStyle)
  const ref = cell.textStyle?.startsWith('$') ? context.theme?.textStyles?.[cell.textStyle.slice(1)] : undefined
  mergeTextFields(base, ref)
  mergeTextFields(base, cell)
  return base
}

export interface PptdCellBorders {
  top?: PptdBorder | null
  right?: PptdBorder | null
  bottom?: PptdBorder | null
  left?: PptdBorder | null
}

/** Expands a BorderSpec into per-side borders; null clears all four sides. */
export function pptdBorderSides(spec: PptdBorderSpec | undefined): PptdCellBorders | undefined {
  if (spec === undefined) return undefined
  if (spec === null) return { top: null, right: null, bottom: null, left: null }
  if (Array.isArray(spec)) {
    if (spec.length === 2) return { top: spec[0], bottom: spec[0], left: spec[1], right: spec[1] }
    return { top: spec[0], right: spec[1], bottom: spec[2], left: spec[3] }
  }
  return { top: spec, right: spec, bottom: spec, left: spec }
}

/** Default cell border per the reference defaults table. */
export const PPTD_CELL_DEFAULT_BORDER: PptdBorder = { style: 'solid', width: 1, color: '#000000' }
