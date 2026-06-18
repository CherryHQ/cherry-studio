import { Table } from '@cherrystudio/extension-table-plus'
import type { JSONContent, MarkdownToken } from '@tiptap/core'

/**
 * Native markdown round-trip for GFM tables.
 *
 * `@cherrystudio/extension-table-plus` ships no markdown hooks, so without this the marked `table`
 * token has no node to map to and `@tiptap/markdown` falls back to rendering it as a raw-text
 * paragraph. We extend the base Table node to map the token to/from the
 * `table -> tableRow -> tableHeader|tableCell -> paragraph` tree.
 *
 * Alignment metadata is intentionally not serialized (parity with the previous turndown-based
 * conversion, which also emitted plain `---` separators).
 */
export const MarkdownTable = Table.extend({
  markdownTokenName: 'table',

  parseMarkdown(token, helpers) {
    const tableToken = token as MarkdownToken & {
      header?: Array<{ tokens?: MarkdownToken[] }>
      rows?: Array<Array<{ tokens?: MarkdownToken[] }>>
    }
    const cell = (type: 'tableHeader' | 'tableCell', tokens?: MarkdownToken[]) =>
      helpers.createNode(type, {}, [helpers.createNode('paragraph', {}, helpers.parseInline(tokens || []))])

    const headerRow = helpers.createNode(
      'tableRow',
      {},
      (tableToken.header || []).map((c) => cell('tableHeader', c.tokens))
    )
    const bodyRows = (tableToken.rows || []).map((row) =>
      helpers.createNode(
        'tableRow',
        {},
        row.map((c) => cell('tableCell', c.tokens))
      )
    )
    return helpers.createNode('table', {}, [headerRow, ...bodyRows])
  },

  renderMarkdown(node, helpers) {
    const rows = (node.content || []).filter((n) => n.type === 'tableRow')
    if (rows.length === 0) return ''

    const renderRow = (row: JSONContent) =>
      `| ${(row.content || [])
        .map((cellNode) =>
          helpers
            .renderChildren(cellNode.content || [])
            .replace(/\r?\n+/g, ' ')
            .replace(/\|/g, '\\|')
            .trim()
        )
        .join(' | ')} |`

    const columns = (rows[0].content || []).length
    const separator = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`

    // GFM tables require a header row. Only treat the first row as the header when it actually
    // contains header cells — a table can lose its header via the row action menu, leaving a
    // `tableCell`-only first row. Emitting that as the header would silently promote a body row to
    // a header on reload, so for headerless tables synthesize an empty header and keep every row as
    // a body row.
    const firstRowIsHeader = (rows[0].content || []).some((cell) => cell.type === 'tableHeader')
    if (firstRowIsHeader) {
      return `${[renderRow(rows[0]), separator, ...rows.slice(1).map(renderRow)].join('\n')}\n\n`
    }
    const emptyHeader = `| ${Array.from({ length: columns }, () => '').join(' | ')} |`
    return `${[emptyHeader, separator, ...rows.map(renderRow)].join('\n')}\n\n`
  }
})
