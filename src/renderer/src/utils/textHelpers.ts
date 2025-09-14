/**
 * Remove the most recent mention trigger from a text.
 *
 * There are two modes:
 * - precise removal when `searchText` is provided: removes the last occurrence of
 *   "@" + searchText to the left of the caret, with a fallback to a known position.
 * - generic removal when `searchText` is undefined: removes the nearest '@' to the left
 *   of the caret along with subsequent non-whitespace until a space/newline/end.
 */
export const removeAtSymbolAndText = (
  currentText: string,
  caretPosition: number,
  searchText?: string,
  fallbackPosition?: number
): string => {
  const safeCaret = Math.max(0, Math.min(caretPosition ?? 0, currentText.length))

  const isWordChar = (ch: string | undefined): boolean => {
    if (!ch) return false
    return /[A-Za-z0-9_]/.test(ch)
  }

  const hasWordBoundaryAfter = (text: string, pos: number): boolean => {
    // pos is the index immediately after a candidate match
    if (pos >= text.length) return true
    const next = text[pos]
    // Boundary iff the following char is NOT a word character
    return !isWordChar(next)
  }

  // ESC/precise delete: prefer pattern = "@" + searchText scanning left from caret
  if (searchText !== undefined) {
    const pattern = '@' + searchText
    const fromIndex = Math.max(0, safeCaret - 1)
    const start = currentText.lastIndexOf(pattern, fromIndex)
    if (start !== -1) {
      const end = start + pattern.length
      // Only treat as a precise match if there is a word boundary after the match
      if (hasWordBoundaryAfter(currentText, end)) {
        return currentText.slice(0, start) + currentText.slice(end)
      }
      // Otherwise, fall through to fallback handling
    }

    // Fallback: use the opening position if available and matches
    if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === '@') {
      const expected = pattern
      const actual = currentText.slice(fallbackPosition, fallbackPosition + expected.length)
      if (actual === expected && hasWordBoundaryAfter(currentText, fallbackPosition + expected.length)) {
        return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + expected.length)
      }
      // If not a full match or not at a boundary, safely remove only the '@'
      return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + 1)
    }

    // No match, return original text
    return currentText
  }

  // Clear button: unknown search term, delete nearest '@' and subsequent non-whitespace
  {
    const fromIndex = Math.max(0, safeCaret - 1)
    const start = currentText.lastIndexOf('@', fromIndex)
    if (start === -1) {
      // Fallback by position if available
      if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === '@') {
        let endPos = fallbackPosition + 1
        while (endPos < currentText.length && currentText[endPos] !== ' ' && currentText[endPos] !== '\n') {
          endPos++
        }
        return currentText.slice(0, fallbackPosition) + currentText.slice(endPos)
      }
      return currentText
    }

    let endPos = start + 1
    while (endPos < currentText.length && currentText[endPos] !== ' ' && currentText[endPos] !== '\n') {
      endPos++
    }
    return currentText.slice(0, start) + currentText.slice(endPos)
  }
}
