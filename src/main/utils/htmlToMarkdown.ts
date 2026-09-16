import type TurndownService from 'turndown'

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
    replacement: (content) => ` ${cellText(content)} |`
  })

  turndown.addRule('tableRow', {
    filter: 'tr',
    replacement: (content, node) => {
      const row = `|${content}`
      if (!isFirstRow(node)) return `\n${row}`
      // A GFM table has to open with a header row, so the first row becomes
      // one. On a page written without <th> that is what it is anyway.
      const columns = node.querySelectorAll('th, td').length
      return `\n${row}\n|${' --- |'.repeat(columns)}`
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
    replacement: (content) => `\n\n${content.trim()}\n\n`
  })

  return turndown
}

/** Turndown has already escaped the cell's backslashes, so only the pipe is left. */
function cellText(content: string): string {
  // Turndown writes a <br> as two spaces and a newline; the whole break folds
  // into one space, because a newline would end the row halfway through.
  return content
    .replace(/[^\S\r\n]*\r?\n[^\S\r\n]*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function isFirstRow(node: HTMLElement): boolean {
  let table: Node | null = node.parentNode
  while (table && table.nodeName !== 'TABLE') table = table.parentNode
  return !!table && (table as HTMLElement).querySelector('tr') === node
}
