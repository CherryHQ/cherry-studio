import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

import { exportErrorCodes } from '@shared/ipc/errors/export'

import { DocumentConversionError } from './DocumentConversionError'
import type { DocumentBlock, DocumentCell, DocumentTextRun } from './documentModel'

export type { DocumentBlock } from './documentModel'

const SAFE_HTML_TAGS = new Set(['a', 'b', 'br', 'del', 'em', 'i', 's', 'strike', 'strong', 'u'])

function safeHtmlTag(content: string): { name: string; close: boolean; href?: string } | null {
  const match = /^<\s*(\/)?\s*([A-Za-z][\w:-]*)\b([^>]*)>$/.exec(content.trim())
  if (!match) return null
  const name = match[2].toLowerCase()
  if (!SAFE_HTML_TAGS.has(name)) return null
  const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[3])
  return { name, close: match[1] === '/', href: href?.[1] ?? href?.[2] }
}

type InlinePiece =
  | { kind: 'text'; text: string; runs: DocumentTextRun[] }
  | { kind: 'image'; source: string; text: string }

function inlineRuns(tokens: Token[], interpretSafeHtml = false): DocumentTextRun[] {
  return readInline(tokens, interpretSafeHtml).flatMap((piece) => (piece.kind === 'text' ? piece.runs : []))
}

function readInline(tokens: Token[], interpretSafeHtml = false): InlinePiece[] {
  const pieces: InlinePiece[] = []
  let current: DocumentTextRun[] = []
  let bold = false
  let italic = false
  let strike = false
  let link: string | undefined
  let htmlBold = 0
  let htmlItalic = 0
  let htmlStrike = 0
  let htmlUnderline = 0
  const htmlLinks: string[] = []
  const flush = () => {
    if (!current.length) return
    pieces.push({ kind: 'text', text: current.map((run) => run.text).join(''), runs: current })
    current = []
  }
  const push = (text: string, font?: string) => {
    if (!text) return
    const activeLink = link ?? htmlLinks.at(-1)
    current.push({
      text,
      bold: bold || htmlBold > 0,
      italic: italic || htmlItalic > 0,
      strike: strike || htmlStrike > 0,
      ...(htmlUnderline > 0 ? { underline: true } : {}),
      ...(activeLink ? { link: activeLink } : {}),
      ...(font ? { font } : {})
    })
  }
  for (const token of tokens) {
    if (token.type === 'image') {
      flush()
      pieces.push({
        kind: 'image',
        source: token.attrGet('src') ?? '',
        text: inlineText(token.children ?? [], interpretSafeHtml)
      })
    } else if (token.type === 'strong_open') bold = true
    else if (token.type === 'strong_close') bold = false
    else if (token.type === 'em_open') italic = true
    else if (token.type === 'em_close') italic = false
    else if (token.type === 's_open') strike = true
    else if (token.type === 's_close') strike = false
    else if (token.type === 'link_open') link = token.attrGet('href') ?? undefined
    else if (token.type === 'link_close') link = undefined
    else if (interpretSafeHtml && token.type === 'html_inline') {
      const tag = safeHtmlTag(token.content)
      if (!tag) {
        push(token.content)
        continue
      }
      if (tag.name === 'br') {
        push('\n')
        continue
      }
      const delta = tag.close ? -1 : 1
      if (tag.name === 'u') htmlUnderline = Math.max(0, htmlUnderline + delta)
      else if (tag.name === 'b' || tag.name === 'strong') htmlBold = Math.max(0, htmlBold + delta)
      else if (tag.name === 'i' || tag.name === 'em') htmlItalic = Math.max(0, htmlItalic + delta)
      else if (tag.name === 's' || tag.name === 'strike' || tag.name === 'del')
        htmlStrike = Math.max(0, htmlStrike + delta)
      else if (tag.name === 'a' && tag.close) htmlLinks.pop()
      else if (tag.name === 'a' && tag.href) htmlLinks.push(tag.href)
    } else if (
      token.type === 'text' ||
      token.type === 'code_inline' ||
      token.type === 'softbreak' ||
      token.type === 'hardbreak'
    ) {
      push(token.type.endsWith('break') ? '\n' : token.content, token.type === 'code_inline' ? 'Consolas' : undefined)
    }
  }
  flush()
  return pieces
}

export function inlineText(tokens: Token[], interpretSafeHtml = false): string {
  return tokens
    .map((token) => {
      if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n'
      if (token.type === 'image') return inlineText(token.children ?? [], interpretSafeHtml)
      if (interpretSafeHtml && token.type === 'html_inline') {
        const tag = safeHtmlTag(token.content)
        if (tag?.name === 'br') return '\n'
        if (tag) return ''
      }
      return token.nesting === 0 ? token.content : ''
    })
    .join('')
}

function tableCellCount(line: string): number {
  const cells: string[] = []
  let cell = ''
  let escaped = false
  for (const character of line.trim()) {
    if (character === '|' && !escaped) {
      cells.push(cell)
      cell = ''
    } else cell += character
    escaped = character === '\\' && !escaped
  }
  cells.push(cell)
  if (!cells[0]?.trim()) cells.shift()
  if (!cells.at(-1)?.trim()) cells.pop()
  return cells.length
}

export function parseMarkdown(
  markdown: string,
  validateTables = true,
  options?: { interpretSafeHtml?: boolean }
): DocumentBlock[] {
  // PDF conversion is the only caller. User Markdown keeps angle brackets as text.
  const interpretSafeHtml = options?.interpretSafeHtml === true
  const parser = new MarkdownIt({ html: interpretSafeHtml })
  const validateLink = parser.validateLink
  // Local image bytes are validated against the document's asset root before conversion.
  parser.validateLink = (url) => url.startsWith('file:') || validateLink(url)
  const tokens = parser.parse(markdown, {})
  const lines = markdown.split('\n')
  const blocks: DocumentBlock[] = []
  let title = ''
  let listDepth = 0
  const lists: { next?: number; current?: number; first: boolean }[] = []
  let quoteDepth = 0
  const openItem = () => {
    if (!listDepth) return {}
    const list = lists.at(-1)
    if (!list?.first) return { listDepth }
    list.first = false
    return {
      bullet: listDepth,
      listDepth,
      ...(list.current !== undefined ? { orderedNumber: list.current } : {})
    }
  }
  const addImages = (token: Token) => {
    for (const child of token.children ?? []) {
      if (child.type === 'image') {
        blocks.push({
          type: 'image',
          source: child.attrGet('src') ?? '',
          text: inlineText(child.children ?? [], interpretSafeHtml)
        })
      } else addImages(child)
    }
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.type === 'heading_open') {
      const level = Number(token.tag.slice(1))
      let headingPlaced = false
      for (const piece of readInline(tokens[index + 1].children ?? [], interpretSafeHtml)) {
        if (piece.kind === 'image') {
          blocks.push({ type: 'image', source: piece.source, text: piece.text, ...openItem() })
          continue
        }
        if (!piece.text.trim()) continue
        if (!headingPlaced) {
          blocks.push({ type: 'heading', level, text: piece.text, runs: piece.runs, ...openItem() })
          if (level <= 2) title = piece.text
          headingPlaced = true
        } else blocks.push({ type: 'text', text: piece.text, runs: piece.runs, ...openItem() })
      }
      index += 2
    } else if (token.type === 'table_open') {
      const rows: string[][] = []
      const cells: DocumentCell[][] = []
      let row: string[] = []
      let cellRow: DocumentCell[] = []
      if (token.map && validateTables) {
        const sourceRows = lines
          .slice(token.map[0], token.map[1])
          .filter((line) => line.trim())
          .map((line, index) => {
            let content = line
            for (let depth = 0; depth < quoteDepth; depth++) content = content.replace(/^\s*>\s?/, '')
            if (listDepth && index === 0) content = content.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '')
            return content
          })
        const columns = tableCellCount(sourceRows[0])
        for (const [rowIndex, line] of sourceRows.entries()) {
          if (tableCellCount(line) !== columns) {
            throw new DocumentConversionError(
              exportErrorCodes.INVALID_TABLE,
              `Table row ${token.map[0] + rowIndex + 1} has a different number of columns.`,
              sourceRows.join('\n').slice(0, 4000)
            )
          }
        }
      }
      while (++index < tokens.length && tokens[index].type !== 'table_close') {
        if (tokens[index].type === 'tr_open') {
          row = []
          cellRow = []
        }
        if (tokens[index].type === 'inline') {
          row.push(inlineText(tokens[index].children ?? [], interpretSafeHtml))
          cellRow.push({ runs: inlineRuns(tokens[index].children ?? [], interpretSafeHtml) })
          addImages(tokens[index])
        }
        if (tokens[index].type === 'tr_close') {
          rows.push(row)
          cells.push(cellRow)
        }
      }
      blocks.push({ type: 'table', title, rows, cells, ...openItem() })
    } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      listDepth++
      lists.push({
        next: token.type === 'ordered_list_open' ? Number(token.attrGet('start') ?? 1) : undefined,
        first: false
      })
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listDepth--
      lists.pop()
    } else if (token.type === 'list_item_open') {
      const list = lists.at(-1)
      if (list) {
        list.first = true
        list.current = list.next
        if (list.next !== undefined) list.next++
      }
    } else if (token.type === 'blockquote_open') {
      quoteDepth++
    } else if (token.type === 'blockquote_close') {
      quoteDepth--
    } else if (token.type === 'inline') {
      for (const piece of readInline(token.children ?? [], interpretSafeHtml)) {
        if (piece.kind === 'image') {
          blocks.push({ type: 'image', source: piece.source, text: piece.text, ...openItem() })
          continue
        }
        if (!piece.text.trim()) continue
        blocks.push({ type: 'text', text: piece.text, runs: piece.runs, ...openItem() })
      }
    } else if (token.type === 'fence' || token.type === 'code_block') {
      blocks.push({ type: 'code', text: token.content, ...openItem() })
    }
  }
  return blocks
}
