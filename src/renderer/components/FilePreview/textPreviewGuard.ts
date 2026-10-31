/**
 * Pathological-input guard for the Markdown splitter.
 *
 * Long lines are the one shape windowing cannot fix: a document that is a single 3 MB line is one
 * indivisible block, so a text node that size still reaches the layout engine whole. This mirrors
 * GitHub linguist's `high_ratio_of_long_lines?` check.
 */
const MAX_AVERAGE_LINE_CHARS = 5000

/**
 * The rule, for a caller that measures the lines while it walks them — the splitter does, so it
 * does not have to walk the source a second time to ask.
 *
 * @param lines - Line count, terminators included as separators rather than as content.
 * @param contentChars - Content characters, excluding every line terminator.
 */
export function isPathologicalLineShape(lines: number, contentChars: number): boolean {
  if (lines === 0) return false
  // The newline separators are not content, so a 5,000-character line lands on the limit, not past it.
  return contentChars / lines > MAX_AVERAGE_LINE_CHARS
}
