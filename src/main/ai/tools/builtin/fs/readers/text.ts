/**
 * Text reader — line-numbered, paginated body.
 *
 * Output shape mirrors the Phase 1A original: `cat -n`-style left-pad
 * line numbers, tab separator, body. Lines longer than `MAX_LINE_LENGTH`
 * truncate with `…`. The model already pattern-matches this format from
 * Claude Code's `Read` tool — keeping it stable means existing prompts
 * and follow-up edits don't drift.
 */

import { readTextFileWithAutoEncoding } from '@main/utils/file'

const MAX_LINE_LENGTH = 2000
export const DEFAULT_READ_LIMIT = 2000

export interface TextReadResult {
  text: string
  startLine: number
  endLine: number
  totalLines: number
}

export async function readAsText(
  absolutePath: string,
  offset: number | undefined,
  limit: number | undefined
): Promise<TextReadResult> {
  const content = await readTextFileWithAutoEncoding(absolutePath)
  return formatLines(content, offset, limit)
}

export function formatLines(content: string, offset: number | undefined, limit: number | undefined): TextReadResult {
  const lines = content.split('\n')
  const totalLines = lines.length

  const startIndex = Math.max(0, (offset ?? 1) - 1)
  const pageLimit = limit ?? DEFAULT_READ_LIMIT
  const endIndex = Math.min(startIndex + pageLimit, totalLines)
  const slice = lines.slice(startIndex, endIndex)

  const text = slice
    .map((line, i) => {
      const lineNo = String(startIndex + i + 1).padStart(6, ' ')
      const truncated = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line
      return `${lineNo}\t${truncated}`
    })
    .join('\n')

  return {
    text,
    startLine: startIndex + 1,
    endLine: endIndex,
    totalLines
  }
}
