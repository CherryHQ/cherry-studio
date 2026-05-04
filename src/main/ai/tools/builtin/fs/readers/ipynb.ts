/**
 * Jupyter notebook reader. Markdown cells render verbatim (model reads
 * prose as prose); code cells get the same line-numbered envelope as
 * plain text so the model can reference specific lines.
 *
 * Notebook `source` per nbformat 4.x can be either a string or a
 * `string[]`; both shapes are normalised here. Parsing goes through
 * AI SDK's `safeParseJSON` against a zod schema so malformed notebooks
 * surface as structured errors rather than throwing through the
 * dispatcher's generic try/catch.
 */

import { readFile } from 'node:fs/promises'

import { safeParseJSON } from '@ai-sdk/provider-utils'
import * as z from 'zod'

import { formatLines, type TextReadResult } from './text'

const cellSchema = z.object({
  cell_type: z.string().optional(),
  source: z.union([z.string(), z.array(z.string())]).optional()
})
const notebookSchema = z.object({
  cells: z.array(cellSchema).optional()
})

function joinSource(source: string | string[] | undefined): string {
  if (!source) return ''
  return Array.isArray(source) ? source.join('') : source
}

export async function readAsIpynb(
  absolutePath: string,
  offset: number | undefined,
  limit: number | undefined
): Promise<TextReadResult> {
  const raw = await readFile(absolutePath, 'utf8')
  const parsed = await safeParseJSON({ text: raw, schema: notebookSchema })
  if (!parsed.success) {
    throw new Error(`Invalid .ipynb: ${parsed.error.message}`)
  }
  const cells = parsed.value.cells ?? []

  const segments: string[] = []
  for (const cell of cells) {
    const body = joinSource(cell.source)
    if (cell.cell_type === 'markdown') {
      segments.push(body)
    } else if (cell.cell_type === 'code') {
      // Line-number code cells. We format each cell standalone so the
      // first line is `1` — model references like "line 2 in the first
      // code cell" stay unambiguous.
      segments.push(formatLines(body, undefined, undefined).text)
    }
    // raw / unknown cell types: skipped — rare and rarely useful.
  }

  // Concatenate cells with a blank line between them, then run through
  // formatLines once more so the outer envelope (totalLines,
  // pagination) is accurate at the notebook level.
  const combined = segments.join('\n\n')
  return formatLines(combined, offset, limit)
}
