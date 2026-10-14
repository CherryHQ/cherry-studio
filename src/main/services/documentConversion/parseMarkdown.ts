import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

import { exportErrorCodes } from '@shared/ipc/errors/export'

import { DocumentConversionError } from './DocumentConversionError'

export type DocumentBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'text' | 'code'; text: string; bullet?: number }
  | { type: 'image'; source: string; text: string }
  | { type: 'table'; title: string; rows: string[][] }

export function inlineText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n'
      if (token.type === 'image') return inlineText(token.children ?? [])
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

export function parseMarkdown(markdown: string): DocumentBlock[] {
  const parser = new MarkdownIt({ html: false })
  const validateLink = parser.validateLink
  // Local image bytes are validated against the document's asset root before conversion.
  parser.validateLink = (url) => url.startsWith('file:') || validateLink(url)
  const tokens = parser.parse(markdown, {})
  const lines = markdown.split('\n')
  const blocks: DocumentBlock[] = []
  let title = ''
  let listDepth = 0
  let quoteDepth = 0
  const addImages = (token: Token) => {
    for (const child of token.children ?? []) {
      if (child.type === 'image') {
        blocks.push({ type: 'image', source: child.attrGet('src') ?? '', text: inlineText(child.children ?? []) })
      } else addImages(child)
    }
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.type === 'heading_open') {
      const level = Number(token.tag.slice(1))
      const text = inlineText(tokens[index + 1].children ?? [])
      blocks.push({ type: 'heading', level, text })
      addImages(tokens[index + 1])
      if (level <= 2) title = text
      index += 2
    } else if (token.type === 'table_open') {
      const rows: string[][] = []
      let row: string[] = []
      if (token.map) {
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
        if (tokens[index].type === 'tr_open') row = []
        if (tokens[index].type === 'inline') {
          row.push(inlineText(tokens[index].children ?? []))
          addImages(tokens[index])
        }
        if (tokens[index].type === 'tr_close') rows.push(row)
      }
      blocks.push({ type: 'table', title, rows })
    } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      listDepth++
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listDepth--
    } else if (token.type === 'blockquote_open') {
      quoteDepth++
    } else if (token.type === 'blockquote_close') {
      quoteDepth--
    } else if (token.type === 'inline') {
      const children = token.children ?? []
      const text = inlineText(children.filter((child) => child.type !== 'image'))
      if (text.trim()) blocks.push({ type: 'text', text, ...(listDepth ? { bullet: listDepth } : {}) })
      addImages(token)
    } else if (token.type === 'fence' || token.type === 'code_block') {
      blocks.push({ type: 'code', text: token.content })
    }
  }
  return blocks
}
