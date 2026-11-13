/**
 * Citation id batch for one lookup call: "3f2a1b9c-1", "3f2a1b9c-2", …
 *
 * The random per-call prefix keeps ids unique across every web/kb lookup call
 * in a conversation without any request- or session-scoped state, so the
 * AI-SDK tool wrappers and the in-process MCP bridge mint ids the same way. The
 * model cites a result by echoing its id as `[cite:id]`; the renderer resolves
 * markers by exact id match against the tool results of the message and of the
 * earlier turns it can see, so a collision is silent and mis-attributes the
 * marker to the earlier result — hence the prefix carries a full 32 bits rather
 * than the handful of characters that uniqueness alone needs.
 */

import { randomUUID } from 'node:crypto'

export function newCitePrefix(): string {
  return randomUUID().slice(0, 8)
}

export function citeId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`
}

const MARKDOWN_CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/gm
const CITATION_MARKER_PATTERN = /([ \t]?)\[cite:[\w-]+\]/g

/** Strip internal citation markers from prose while preserving literal examples in code. */
export function stripCitationMarkers(text: string): string {
  MARKDOWN_CODE_PATTERN.lastIndex = 0
  let cursor = 0
  let result = ''
  let match: RegExpExecArray | null

  while ((match = MARKDOWN_CODE_PATTERN.exec(text)) !== null) {
    result += text.slice(cursor, match.index).replace(CITATION_MARKER_PATTERN, '')
    result += match[0]
    cursor = match.index + match[0].length
  }

  return result + text.slice(cursor).replace(CITATION_MARKER_PATTERN, '')
}
