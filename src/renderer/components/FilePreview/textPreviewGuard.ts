/**
 * Pathological-input guard shared by the text and Markdown previews.
 *
 * Long lines are the one shape windowing cannot fix: a document that is a single 3 MB line is one
 * indivisible block, so a text node that size still reaches the layout engine whole. This mirrors
 * GitHub linguist's `high_ratio_of_long_lines?` check.
 */
const MAX_AVERAGE_LINE_CHARS = 5000

/**
 * The same rule, for a caller that already measured the lines — the Markdown splitter does, while it
 * walks them, so it does not have to walk the source a second time to ask.
 *
 * @param lines - Line count, terminators included as separators rather than as content.
 * @param contentChars - Content characters, excluding every line terminator.
 */
export function isPathologicalLineShape(lines: number, contentChars: number): boolean {
  if (lines === 0) return false
  // The newline separators are not content, so a 5,000-character line lands on the limit, not past it.
  return contentChars / lines > MAX_AVERAGE_LINE_CHARS
}

/** Line count and content length without materializing the line array. */
function measureLines(content: string): { lines: number; contentChars: number } {
  if (content.length === 0) return { lines: 0, contentChars: 0 }
  // A line ends at LF, CR, or CRLF, so a document written with any of them is counted the same way.
  let terminators = 0
  let terminatorChars = 0
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i)
    if (code === 13) {
      terminators++
      if (content.charCodeAt(i + 1) === 10) terminatorChars += 2
      else terminatorChars += 1
    } else if (code === 10) {
      // A CR already counted this separator as the CRLF's first character.
      if (content.charCodeAt(i - 1) !== 13) {
        terminators++
        terminatorChars += 1
      }
    }
  }
  // A trailing terminator ends its line rather than starting a second one.
  return {
    lines: /[\r\n]$/.test(content) ? terminators : terminators + 1,
    contentChars: content.length - terminatorChars
  }
}

/**
 * Whether a document is so dominated by very long lines that no renderer can window it.
 *
 * @param content - The already-read file content.
 */
export function hasPathologicalLongLines(content: string): boolean {
  const { lines, contentChars } = measureLines(content)
  return isPathologicalLineShape(lines, contentChars)
}
