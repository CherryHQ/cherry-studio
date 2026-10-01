/**
 * Pathological-input guard shared by the text and Markdown previews.
 *
 * Long lines are the one shape windowing cannot fix: a document that is a single 3 MB line is one
 * indivisible block, so a text node that size still reaches the layout engine whole. This mirrors
 * GitHub linguist's `high_ratio_of_long_lines?` check.
 */
const MAX_AVERAGE_LINE_CHARS = 5000

/** Line count and content length without materializing the line array. */
function measureLines(content: string): { lines: number; contentChars: number } {
  if (content.length === 0) return { lines: 0, contentChars: 0 }
  let newlines = 0
  let crlf = 0
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) !== 10) continue
    newlines++
    if (i > 0 && content.charCodeAt(i - 1) === 13) crlf++
  }
  // Line terminators are not content: a CRLF is two characters for one separator, and a trailing
  // newline terminates its line rather than starting a second one.
  return {
    lines: content.endsWith('\n') ? newlines : newlines + 1,
    contentChars: content.length - newlines - crlf
  }
}

/**
 * Whether a document is so dominated by very long lines that no renderer can window it.
 *
 * @param content - The already-read file content.
 */
export function hasPathologicalLongLines(content: string): boolean {
  const { lines, contentChars } = measureLines(content)
  if (lines === 0) return false
  // The newline separators are not content, so a 5,000-character line lands on the limit, not past it.
  return contentChars / lines > MAX_AVERAGE_LINE_CHARS
}
