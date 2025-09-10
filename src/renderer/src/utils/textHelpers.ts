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

  // ESC/precise delete: prefer pattern = "@" + searchText scanning left from caret
  if (searchText !== undefined) {
    const pattern = '@' + searchText
    const fromIndex = Math.max(0, safeCaret - 1)
    const start = currentText.lastIndexOf(pattern, fromIndex)
    if (start !== -1) {
      const end = start + pattern.length
      return currentText.slice(0, start) + currentText.slice(end)
    }

    // Fallback: use the opening position if available and matches
    if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === '@') {
      const expected = pattern
      const actual = currentText.slice(fallbackPosition, fallbackPosition + expected.length)
      if (actual === expected) {
        return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + expected.length)
      }
      // If not a full match, safely remove only the '@'
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
