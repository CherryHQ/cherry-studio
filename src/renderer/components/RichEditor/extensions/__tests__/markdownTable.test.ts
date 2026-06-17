import type { JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { MarkdownTable } from '../markdownTable'

const manager = new MarkdownManager({ extensions: [StarterKit, MarkdownTable] })

const cell = (type: 'tableHeader' | 'tableCell', text: string): JSONContent => ({
  type,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})
const row = (type: 'tableHeader' | 'tableCell', ...texts: string[]): JSONContent => ({
  type: 'tableRow',
  content: texts.map((t) => cell(type, t))
})
const table = (...rows: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'table', content: rows }] })

describe('MarkdownTable serialization', () => {
  it('keeps a real header row as the GFM header', () => {
    const md = manager.serialize(table(row('tableHeader', 'a', 'b'), row('tableCell', '1', '2'))).trim()
    expect(md).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('synthesizes an empty header for a headerless table instead of promoting the first body row', () => {
    // A table can lose its header via the row action menu, leaving a tableCell-only first row.
    const md = manager.serialize(table(row('tableCell', 'a', 'b'), row('tableCell', 'c', 'd'))).trim()
    const lines = md.split('\n')
    expect(lines[1]).toBe('| --- | --- |') // separator on line 2 => line 1 is the (empty) header
    // Both data rows must stay below the separator (i.e. remain body rows), not be promoted.
    expect(lines.indexOf('| a | b |')).toBeGreaterThan(1)
    expect(lines.indexOf('| c | d |')).toBeGreaterThan(1)
  })
})
