import type TurndownService from 'turndown'

// HTML clamps colspan to 1..1000, and a rowspan never reaches past its table.
const MAX_COLSPAN = 1000
// A span on a fetched page must not blow the output up: a table is padded to a full grid only
// while the grid stays within a few cells per real cell, and is written row by row otherwise.
const GRID_CELLS_PER_CELL = 8
const MIN_GRID_CELLS = 64
const MAX_GRID_CELLS = 40_000

/**
 * Give a Turndown service the table rules it does not ship with.
 *
 * Turndown has no table support of its own, so a `<table>` is flattened into
 * one paragraph per cell: a price ends up several blank lines away from the
 * product it belongs to, and nothing records which column it came from.
 *
 * `turndown-plugin-gfm` is the usual answer and is not used here on purpose:
 * it emits a table that carries no `<th>` as raw HTML, does not escape a pipe
 * inside a cell, and lets a `<br>` break the row in half.
 */
export function applyTableRules(turndown: TurndownService): TurndownService {
  turndown.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const grid = gridFor(node)
      // Markdown has no merged cells, so a span becomes the empty cells the
      // columns it covers would otherwise be missing.
      const before = ' |'.repeat(grid.before.get(node) ?? 0)
      const spanned = ' |'.repeat((grid.colspan.get(node) ?? 1) - 1)
      return `${before} ${cellText(content)} |${spanned}`
    }
  })

  turndown.addRule('tableRow', {
    filter: 'tr',
    replacement: (content, node) => {
      const grid = gridFor(node)
      const row = `|${content}${' |'.repeat(grid.after.get(node) ?? 0)}`
      if (node !== grid.header) return `\n${row}`
      // A GFM table has to open with a header row, so the first row that has
      // cells becomes one. On a page written without <th> that is what it is.
      return `\n${row}\n|${' --- |'.repeat(grid.headerWidth)}`
    }
  })

  // A section wrapper must not put a blank line between the header row and the
  // body, because a blank line ends the table.
  turndown.addRule('tableSection', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: (content) => content
  })

  turndown.addRule('tableCaption', {
    filter: 'caption',
    replacement: (content) => (content.trim() ? `${content.trim()}\n\n` : '')
  })

  turndown.addRule('table', {
    filter: 'table',
    // Turndown writes a row with no cells as a blank line, and a blank line ends the table.
    replacement: (content) => `\n\n${content.trim().replace(/^(\|.*)\n\s*\n(?=\|)/gm, '$1\n')}\n\n`
  })

  return turndown
}

function cellText(content: string): string {
  // A <br> folds into one space, since a newline would end the row; splitting avoids the
  // quadratic backtracking a `\s*\n\s*` regex has on a long run of &nbsp;.
  return escapePipes(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .join(' ')
      .trim()
  )
}

// GFM splits a row at a pipe after an even run of backslashes. Turndown doubles them in text,
// not in a code span, so the run is counted and only an even one gets one more.
function escapePipes(text: string): string {
  const parts = text.split('|')
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index]
    let run = 0
    while (run < part.length && part[part.length - 1 - run] === '\\') run++
    if (run % 2 === 0) parts[index] = `${part}\\`
  }
  return parts.join('|')
}

function tableOf(node: Node): HTMLElement | null {
  let parent: Node | null = node.parentNode
  while (parent && parent.nodeName !== 'TABLE') parent = parent.parentNode
  return (parent as HTMLElement) ?? null
}

interface TableGrid {
  /** The row the delimiter goes under: the first one that has cells. */
  header: Element | null
  headerWidth: number
  /** Empty cells a cell needs in front of it, because a rowspan holds those columns. */
  before: Map<Element, number>
  /** Columns a cell covers once its colspan is clamped. */
  colspan: Map<Element, number>
  /** Empty cells a row needs at its end, to reach the width of the widest row. */
  after: Map<Element, number>
}

type Layout = Omit<TableGrid, 'header' | 'headerWidth'> & { width: number }

const NOT_IN_A_TABLE: TableGrid = {
  header: null,
  headerWidth: 0,
  before: new Map(),
  colspan: new Map(),
  after: new Map()
}

const grids = new WeakMap<Element, TableGrid>()

function gridFor(node: Element): TableGrid {
  const table = tableOf(node)
  if (!table) return NOT_IN_A_TABLE
  let grid = grids.get(table)
  if (!grid) {
    grid = measure(table)
    grids.set(table, grid)
  }
  return grid
}

function measure(table: Element): TableGrid {
  const rows = Array.from(table.querySelectorAll('tr')).filter((row) => tableOf(row) === table)
  const cells = rows.map(cellsOf)
  const headerIndex = cells.findIndex((rowCells) => rowCells.length > 0)
  const header = headerIndex >= 0 ? rows[headerIndex] : null

  const layout = layOut(rows, cells)
  if (layout) return { header, headerWidth: layout.width, ...layout }
  return {
    header,
    headerWidth: headerIndex >= 0 ? cells[headerIndex].length : 0,
    before: new Map(),
    colspan: new Map(),
    after: new Map()
  }
}

/** Lay the table out on a grid the way a browser does, or return null once it outgrows its budget. */
function layOut(rows: Element[], cells: Element[][]): Layout | null {
  const before = new Map<Element, number>()
  const colspan = new Map<Element, number>()
  const widths: number[] = []
  const taken = new Set<string>()
  let width = 0
  const realCells = cells.reduce((total, rowCells) => total + rowCells.length, 0)
  const budget = Math.min(MAX_GRID_CELLS, MIN_GRID_CELLS + GRID_CELLS_PER_CELL * realCells)

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    let column = 0
    const free = (): number => {
      let skipped = 0
      while (taken.has(`${rowIndex},${column}`)) {
        column++
        skipped++
      }
      return skipped
    }
    for (const cell of cells[rowIndex]) {
      before.set(cell, free())
      const across = spanOf(cell, 'colspan', MAX_COLSPAN)
      const down = spanOf(cell, 'rowspan', rows.length - rowIndex)
      if (taken.size + across * down > budget) return null
      colspan.set(cell, across)
      for (let r = 0; r < down; r++) {
        for (let c = 0; c < across; c++) taken.add(`${rowIndex + r},${column + c}`)
      }
      column += across
    }
    // `column` is the width the row emits cells for. Trailing slots a rowspan
    // from above still claims widen the table, and become right-side padding.
    widths.push(column)
    free()
    width = Math.max(width, column)
  }

  // A row with no cells is never written, so only the others are padded.
  const writtenRows = cells.filter((rowCells) => rowCells.length > 0).length
  if (width * writtenRows > budget) return null
  const after = new Map<Element, number>()
  rows.forEach((row, index) => after.set(row, width - widths[index]))
  return { width, before, colspan, after }
}

function cellsOf(row: Element): Element[] {
  return Array.from(row.children).filter((child) => child.nodeName === 'TH' || child.nodeName === 'TD')
}

function spanOf(cell: Element, attribute: 'colspan' | 'rowspan', max: number): number {
  const value = Number.parseInt(cell.getAttribute(attribute) ?? '', 10)
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : 1
}
