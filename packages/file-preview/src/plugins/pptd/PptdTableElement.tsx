import type { CSSProperties } from 'react'

import type { PptdBorder, PptdTable } from './pptdFormat'
import { pptdTextStyleCss, renderPptdRichText } from './pptdRichText'
import { pptdColorToCss, pptdFillToCss, type PptdStyleContext } from './pptdStyle'
import {
  PPTD_CELL_DEFAULT_BORDER,
  placePptdTableCells,
  pptdBorderSides,
  resolvePptdCellCategoryStyle,
  resolvePptdCellTextStyle,
  resolvePptdTableStyleConfig
} from './pptdTable'

function borderCss(border: PptdBorder | null | undefined, context: PptdStyleContext): CSSProperties | undefined {
  if (border === undefined) return undefined
  if (border === null) return { border: 'none' }
  const color = pptdColorToCss(border.color ?? '#000000', context) ?? '#000000'
  const style = border.style === 'dash' ? 'dashed' : border.style === 'dot' ? 'dotted' : 'solid'
  return { border: `${border.width ?? 1}px ${style} ${color}` }
}

function normalizeRatios(values: readonly number[] | undefined, count: number): number[] {
  const ratios = Array.from({ length: count }, (_, index) => values?.[index] ?? 1 / count)
  const sum = ratios.reduce((a, b) => a + b, 0)
  return sum > 0 ? ratios.map((v) => v / sum) : ratios.map(() => 1 / count)
}

export function PptdTableElement({ element, context }: { element: PptdTable; context: PptdStyleContext }) {
  const rows = element.rows
  const rowCount = rows.length
  const colCount = element.columnWidths?.length ?? Math.max(...rows.map((row) => row.length), 1)
  const colRatios = normalizeRatios(element.columnWidths, colCount)
  const rowRatios = normalizeRatios(element.rowHeights, rowCount)
  const config = resolvePptdTableStyleConfig(element.style, context)
  const placements = placePptdTableCells(rows)

  const shadow = element.shadow
  const filter = shadow
    ? `drop-shadow(${shadow.offset?.[0] ?? 2}px ${shadow.offset?.[1] ?? 2}px ${shadow.blur}px ${
        pptdColorToCss(shadow.color, context) ?? 'rgba(0,0,0,0.4)'
      })`
    : undefined

  const byRow = new Map<number, typeof placements>()
  for (const placement of placements) {
    const list = byRow.get(placement.row) ?? []
    list.push(placement)
    byRow.set(placement.row, list)
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        filter,
        overflow: 'hidden',
        ...pptdFillToCss(element.fill, context)
      }}>
      <table
        style={{
          width: '100%',
          height: '100%',
          tableLayout: 'fixed',
          borderCollapse: 'collapse',
          borderSpacing: 0
        }}>
        <colgroup>
          {colRatios.map((ratio, index) => (
            <col key={index} style={{ width: `${ratio * 100}%` }} />
          ))}
        </colgroup>
        <tbody>
          {Array.from({ length: rowCount }, (_, r) => (
            <tr key={r} style={{ height: `${rowRatios[r] * 100}%` }}>
              {(byRow.get(r) ?? []).map(({ cell, col, rowSpan, colSpan }) => {
                const category = resolvePptdCellCategoryStyle(config, r, col, rowCount, colCount)
                const textStyle = resolvePptdCellTextStyle(cell, category, context)
                const align = cell.align ?? category.align ?? (['center', 'middle'] as const)
                // Border chain: defaults < category < cell, with null clearing.
                const categoryBorders = pptdBorderSides(category.border)
                const cellBorders = pptdBorderSides(cell.border)
                const sides = cellBorders ??
                  categoryBorders ?? {
                    top: PPTD_CELL_DEFAULT_BORDER,
                    right: PPTD_CELL_DEFAULT_BORDER,
                    bottom: PPTD_CELL_DEFAULT_BORDER,
                    left: PPTD_CELL_DEFAULT_BORDER
                  }
                const fillCss = pptdFillToCss(cell.fill ?? category.fill, context)
                const sideCss = (border: PptdBorder | null | undefined, side: 'Top' | 'Right' | 'Bottom' | 'Left') => {
                  const css = borderCss(border, context)
                  if (!css?.border) return { [`border${side}`]: 'none' } as CSSProperties
                  return { [`border${side}`]: css.border } as CSSProperties
                }
                return (
                  <td
                    key={col}
                    colSpan={colSpan}
                    rowSpan={rowSpan}
                    style={{
                      verticalAlign: align[1] === 'middle' ? 'middle' : align[1] === 'bottom' ? 'bottom' : 'top',
                      padding: 4,
                      overflow: 'hidden',
                      ...fillCss,
                      ...sideCss(sides.top, 'Top'),
                      ...sideCss(sides.right, 'Right'),
                      ...sideCss(sides.bottom, 'Bottom'),
                      ...sideCss(sides.left, 'Left')
                    }}>
                    <div style={pptdTextStyleCss({ ...textStyle }, context)}>
                      {cell.text ? renderPptdRichText(cell.text, { context, align: [align[0], align[1]] }) : null}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
