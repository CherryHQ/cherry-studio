/** Longest line the editor soft-wraps; wrapping one 256 KB line costs ~0.1 s of layout, 4 MB costs seconds. */
export const SOFT_WRAP_MAX_LINE_LENGTH = 256 * 1024

/** Whether `text` has a line too long to soft-wrap without freezing the editor. */
export function hasUnwrappableLine(text: string): boolean {
  if (text.length <= SOFT_WRAP_MAX_LINE_LENGTH) return false
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf('\n', start)
    const end = newline < 0 ? text.length : newline
    if (end - start > SOFT_WRAP_MAX_LINE_LENGTH) return true
    start = end + 1
  }
  return false
}
