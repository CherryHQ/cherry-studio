import type { GhosttyCell, GhosttyRow, TerminalCellStyle, TerminalWireRow } from '@shared/types/terminal'

export function encodeTerminalRows(rows: readonly GhosttyRow[]) {
  const styles: TerminalCellStyle[] = []
  const ids = new Map<string, number>()
  const rowData: TerminalWireRow[] = rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const flags =
        Number(cell.bold) |
        (Number(cell.italic) << 1) |
        (Number(cell.invisible) << 2) |
        (Number(cell.strikethrough) << 3) |
        (Number(cell.overline) << 4) |
        (Number(cell.underline) << 5) |
        (Number(cell.selected) << 6)
      const style: TerminalCellStyle = [
        cell.foreground.r,
        cell.foreground.g,
        cell.foreground.b,
        cell.background.r,
        cell.background.g,
        cell.background.b,
        flags
      ]
      const key = style.join(',')
      let index = ids.get(key)
      if (index === undefined) {
        index = styles.length
        ids.set(key, index)
        styles.push(style)
      }
      return [index, cell.text, cell.wide] as const
    })
  }))
  return { styles, rowData }
}

export function decodeTerminalRows(
  rows: readonly TerminalWireRow[],
  styles: readonly TerminalCellStyle[]
): GhosttyRow[] {
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map(([index, text, wide]): GhosttyCell => {
      const style = styles[index]
      if (!style) throw new Error('Invalid terminal cell style')
      const [r, g, b, br, bg, bb, flags] = style
      return {
        text,
        wide,
        foreground: { r, g, b },
        background: { r: br, g: bg, b: bb },
        bold: Boolean(flags & 1),
        italic: Boolean(flags & 2),
        invisible: Boolean(flags & 4),
        strikethrough: Boolean(flags & 8),
        overline: Boolean(flags & 16),
        underline: Boolean(flags & 32),
        selected: Boolean(flags & 64)
      }
    })
  }))
}
